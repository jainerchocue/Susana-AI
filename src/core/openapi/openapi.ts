import { z, type ZodTypeAny } from 'zod';
import { env } from '../../config/env';
import { BRAND } from '../../config/constants';
import { ErrorCode } from '../http/http-status';
import { auth } from '../auth/auth';
import { logger } from '../logger';
import { registroOpenApi, type RutaDocumentada } from './registry';

/**
 * Genera el contrato OpenAPI 3.1 a partir de los MISMOS schemas de Zod que
 * validan las peticiones. Al ser fuente unica, no puede desincronizarse del
 * codigo, que es el fallo cronico de la documentacion escrita a mano (M-09).
 *
 * ponytail: sin dependencia de generacion. `zod-to-json-schema` haria falta si
 * hubiera que soportar schemas arbitrarios; aqui basta con un conversor de los
 * tipos que realmente usamos.
 */

type JsonSchema = Record<string, unknown>;

/** `{type: 'x'}` o `{type: ['x','null']}` -> version que ademas admite `null`. */
function conNullable(schema: JsonSchema): JsonSchema {
  const tipo = schema.type;
  if (typeof tipo === 'string') return { ...schema, type: [tipo, 'null'] };
  if (Array.isArray(tipo)) {
    // `Array.isArray` estrecha a `any[]` (lib.es5.d.ts): se retipa a `unknown[]`
    // antes de esparcir para no colar un `any` implicito (regla del lint).
    const lista: unknown[] = tipo;
    return { ...schema, type: [...lista, 'null'] };
  }
  // Sin un `type` simple (enum, anyOf, const...): envolver es lo unico generico.
  return { anyOf: [schema, { type: 'null' }] };
}

type ZodCheck = { kind: string; value?: number };

/** `z.string()`: min/max de longitud y los 4 formatos que usa el proyecto. */
function esquemaString(checks: ZodCheck[]): JsonSchema {
  const salida: JsonSchema = { type: 'string' };
  const formatos: Record<string, string> = { email: 'email', uuid: 'uuid', url: 'uri', datetime: 'date-time' };
  for (const c of checks) {
    if (c.kind === 'min') salida.minLength = c.value;
    else if (c.kind === 'max') salida.maxLength = c.value;
    else if (c.kind in formatos) salida.format = formatos[c.kind];
  }
  return salida;
}

/** `z.number()`: `int` decide `integer` vs `number`; min/max se traducen a limites. */
function esquemaNumber(checks: ZodCheck[]): JsonSchema {
  const esEntero = checks.some((c) => c.kind === 'int');
  const salida: JsonSchema = { type: esEntero ? 'integer' : 'number' };
  for (const c of checks) {
    if (c.kind === 'min') salida.minimum = c.value;
    if (c.kind === 'max') salida.maximum = c.value;
  }
  return salida;
}

/** `z.object({...})`, con `.strict()` reflejado en `additionalProperties: false`. */
function esquemaObjeto(def: { shape: () => Record<string, ZodTypeAny>; unknownKeys?: unknown }): JsonSchema {
  const shape = def.shape();
  const properties: JsonSchema = {};
  const required: string[] = [];
  for (const [clave, valor] of Object.entries(shape)) {
    properties[clave] = aJsonSchema(valor);
    if (!valor.isOptional()) required.push(clave);
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: def.unknownKeys === 'strict' ? false : undefined,
  };
}

/**
 * Constructores "envoltorio": no aportan forma propia, solo delegan en el tipo
 * que envuelven. Aparte de `ZodNullable` (que ademas marca `null` admitido),
 * separarlos del `switch` principal es lo que mantiene su complejidad ciclomatica
 * bajo control: cada `case` cuenta como una rama, compartan cuerpo o no.
 */
const CLAVE_TIPO_INTERNO: Record<string, string> = {
  ZodOptional: 'innerType',
  ZodDefault: 'innerType',
  ZodCatch: 'innerType',
  ZodEffects: 'schema',
  ZodPipeline: 'out',
};

/**
 * Conversor Zod -> JSON Schema para los constructores que emplea el proyecto:
 * objetos, arrays, enums (de string y nativos), uniones (incluidas las que
 * mezclan tipos, p. ej. `number | 'insufficient_data'`), opcionales/nullable,
 * literales, records y fechas (`string`, `format: 'date-time'`).
 * Zod 4 trae `z.toJSONSchema()` nativo: al migrar, esta funcion se sustituye
 * por esa llamada y se borra.
 */
function aJsonSchema(schema: ZodTypeAny): JsonSchema {
  const def = schema._def as { typeName?: string; [k: string]: unknown };
  const tipo = def.typeName ?? '';

  if (tipo === 'ZodNullable') return conNullable(aJsonSchema(def.innerType as ZodTypeAny));
  const claveInterno = CLAVE_TIPO_INTERNO[tipo];
  if (claveInterno) return aJsonSchema(def[claveInterno] as ZodTypeAny);

  switch (tipo) {
    case 'ZodString':
      return esquemaString((def.checks ?? []) as ZodCheck[]);
    case 'ZodNumber':
      return esquemaNumber((def.checks ?? []) as ZodCheck[]);
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodDate':
      return { type: 'string', format: 'date-time' };
    case 'ZodLiteral':
      return { const: def.value };
    case 'ZodEnum':
      return { type: 'string', enum: def.values };
    case 'ZodNativeEnum':
      return { type: 'string', enum: Object.values(def.values as Record<string, string>) };
    case 'ZodArray':
      return { type: 'array', items: aJsonSchema(def.type as ZodTypeAny) };
    case 'ZodObject':
      return esquemaObjeto(def as { shape: () => Record<string, ZodTypeAny>; unknownKeys?: unknown });
    case 'ZodUnion':
      return { anyOf: (def.options as ZodTypeAny[]).map(aJsonSchema) };
    case 'ZodRecord':
      return { type: 'object', additionalProperties: aJsonSchema(def.valueType as ZodTypeAny) };
    default:
      return {};
  }
}

const META_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { requestId: { type: 'string' }, timestamp: { type: 'string', format: 'date-time' } },
};

/**
 * Sobre de error compartido por TODA respuesta no exitosa (core/http/api-response.ts).
 * `code` enumera los valores reales de `ErrorCode`: el cliente conmuta sobre
 * el codigo, nunca sobre el mensaje (CLAUDE.md §3), asi que el contrato debe
 * decir exactamente que codigos existen.
 */
const RESPUESTA_ERROR: JsonSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', const: false },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', enum: Object.values(ErrorCode) },
        message: { type: 'string' },
        details: {
          type: 'array',
          items: {
            type: 'object',
            properties: { field: { type: 'string' }, message: { type: 'string' }, code: { type: 'string' } },
          },
        },
      },
      required: ['code', 'message'],
    },
    meta: META_SCHEMA,
  },
  required: ['success', 'error', 'meta'],
};

function respuestaExito(dataSchema?: ZodTypeAny): JsonSchema {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean', const: true },
      data: dataSchema ? aJsonSchema(dataSchema) : { type: 'object' },
      meta: META_SCHEMA,
    },
    required: ['success', 'data', 'meta'],
  };
}

/** Sobre de listado (`core/http/api-response.ts#paginated`): `data` es un array y hay `pagination`. */
function respuestaPaginada(dataSchema?: ZodTypeAny): JsonSchema {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean', const: true },
      data: { type: 'array', items: dataSchema ? aJsonSchema(dataSchema) : { type: 'object' } },
      pagination: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
          hasNext: { type: 'boolean' },
          nextCursor: conNullable({ type: 'string' }),
          page: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
          hasPrev: { type: 'boolean' },
        },
        required: ['limit', 'hasNext', 'nextCursor'],
      },
      meta: META_SCHEMA,
    },
    required: ['success', 'data', 'pagination', 'meta'],
  };
}

/** Cuerpo de exito de una operacion: el sobre estandar, el de listado, o CSV crudo (exports/plantillas). */
function respuestaExitoDeRuta(ruta: RutaDocumentada): JsonSchema {
  if (ruta.produces === 'text/csv') {
    return {
      description: 'Operacion correcta (CSV)',
      content: { 'text/csv': { schema: { type: 'string' } } },
    };
  }
  const cuerpo = ruta.paginated ? respuestaPaginada(ruta.response) : respuestaExito(ruta.response);
  return { description: 'Operacion correcta', content: { 'application/json': { schema: cuerpo } } };
}

/** `requestBody`: JSON (por defecto, si hay `body`) o `text/csv` crudo (`POST /imports/:table`). */
function requestBodyDeRuta(ruta: RutaDocumentada): JsonSchema | undefined {
  if (ruta.contentType === 'text/csv') {
    return {
      required: true,
      description: 'Archivo CSV en crudo (sin multipart): el cuerpo ENTERO de la peticion es el archivo.',
      content: { 'text/csv': { schema: { type: 'string' } } },
    };
  }
  if (ruta.body) {
    return { required: true, content: { 'application/json': { schema: aJsonSchema(ruta.body) } } };
  }
  return undefined;
}

const CODIGOS_GENERICOS = [401, 403, 422, 429, 500] as const;

const DESCRIPCION_CODIGO: Record<number, string> = {
  400: 'Peticion invalida (JSON malformado)',
  401: 'No autenticado',
  403: 'Permisos insuficientes o fuera de ambito',
  404: 'Recurso no encontrado (o fuera del ambito del actor: mismo codigo, anti-enumeracion)',
  409: 'Conflicto: transicion, dependencia o estado invalido',
  413: 'El cuerpo supera el tamaño maximo permitido',
  415: 'Content-Type no soportado',
  422: 'Validacion fallida',
  429: 'Demasiadas peticiones',
  500: 'Error interno',
  502: 'Respuesta invalida de un servicio externo (agente IA)',
  503: 'Servicio no disponible',
};

/** Respuestas de error: las genericas (401/403/422/429/500) mas las propias de la ruta. */
function respuestasDeError(ruta: RutaDocumentada): Record<string, JsonSchema> {
  const codigos = new Set<number>([...CODIGOS_GENERICOS, ...(ruta.errors ?? [])]);
  const respuestas: Record<string, JsonSchema> = {};
  for (const codigo of [...codigos].sort((a, b) => a - b)) {
    respuestas[String(codigo)] = {
      description: DESCRIPCION_CODIGO[codigo] ?? 'Error',
      content: { 'application/json': { schema: RESPUESTA_ERROR } },
    };
  }
  return respuestas;
}

function construirOperacion(ruta: RutaDocumentada): JsonSchema {
  const parametros: JsonSchema[] = [];

  if (ruta.params) {
    const shape = (ruta.params._def as { shape: () => Record<string, ZodTypeAny> }).shape();
    for (const [nombre, esquema] of Object.entries(shape)) {
      parametros.push({ name: nombre, in: 'path', required: true, schema: aJsonSchema(esquema) });
    }
  }

  if (ruta.query) {
    const def = ruta.query._def as { shape?: () => Record<string, ZodTypeAny> };
    const shape = def.shape?.() ?? {};
    for (const [nombre, esquema] of Object.entries(shape)) {
      parametros.push({
        name: nombre,
        in: 'query',
        required: !esquema.isOptional(),
        schema: aJsonSchema(esquema),
      });
    }
  }

  const requestBody = requestBodyDeRuta(ruta);

  return {
    summary: ruta.summary,
    description: ruta.description,
    tags: [ruta.tag],
    // Cookie o Bearer: cualquiera de las dos autentica (`authenticate.ts` acepta ambas).
    ...(ruta.auth ? { security: [{ bearerAuth: [] }, { cookieAuth: [] }] } : {}),
    ...(parametros.length > 0 ? { parameters: parametros } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses: {
      [String(ruta.status ?? 200)]: respuestaExitoDeRuta(ruta),
      ...respuestasDeError(ruta),
    },
  };
}

/**
 * Esquema de Better Auth (`/auth/**`), fusionado bajo `{API_PREFIX}/auth` en el
 * MISMO `openapi.json`: copiarlo a mano garantizaria que el dia que la
 * libreria cambie, este contrato mienta. `auth.api.generateOpenAPISchema()` es
 * la misma llamada de servidor que expone `{API_PREFIX}/auth/reference`
 * (`core/auth/auth.ts`, plugin `openAPI`), sin pasar por HTTP.
 *
 * Nunca lanza: si el generador de Better Auth cambiara de forma incompatible,
 * el resto del contrato (nuestras rutas) debe seguir sirviendose igual.
 */
async function esquemaAuthFusionado(): Promise<{ paths: Record<string, JsonSchema>; schemas: JsonSchema }> {
  try {
    const esquema = await auth.api.generateOpenAPISchema();
    const paths: Record<string, JsonSchema> = {};
    for (const [ruta, operaciones] of Object.entries(esquema.paths)) {
      // Better Auth tipa cada entrada como `Path` (interfaz sin index
      // signature): un literal fresco (`{ ...operaciones }`) es estructuralmente
      // igual y si es asignable a `JsonSchema` (Record<string, unknown>).
      paths[`${env.API_PREFIX}/auth${ruta}`] = { ...operaciones };
    }
    return { paths, schemas: { ...esquema.components.schemas } };
  } catch (error) {
    logger.warn({ err: error }, 'No se pudo fusionar el esquema OpenAPI de Better Auth');
    return { paths: {}, schemas: {} };
  }
}

export async function construirOpenApi(): Promise<JsonSchema> {
  const paths: Record<string, JsonSchema> = {};

  for (const ruta of registroOpenApi) {
    // OpenAPI usa {id}; Express usa :id. Con `ruta.path === ''` (el indice),
    // el resultado es exactamente `env.API_PREFIX`.
    const ruteo = `${env.API_PREFIX}${ruta.path.replace(/:(\w+)/g, '{$1}')}`;
    paths[ruteo] ??= {};
    (paths[ruteo] as Record<string, unknown>)[ruta.method] = construirOperacion(ruta);
  }

  const fusionAuth = await esquemaAuthFusionado();
  for (const [ruta, operaciones] of Object.entries(fusionAuth.paths)) {
    paths[ruta] = operaciones;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: `${BRAND.name} API`,
      version: '1.0.0',
      description: 'Contrato generado desde los schemas de Zod que validan cada peticion.',
      contact: { email: BRAND.supportEmail },
    },
    servers: [{ url: env.API_URL }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Authorization: Bearer <token>. Lo emite Better Auth (plugin bearer) al iniciar sesion.',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description: 'Cookie de sesion httpOnly de Better Auth. Via preferida desde el frontend React.',
        },
      },
      schemas: fusionAuth.schemas,
    },
    tags: [
      { name: 'index', description: 'Indice de la API' },
      { name: 'auth', description: 'Registro, sesion, MFA (Better Auth)' },
      { name: 'users', description: 'Gestion de usuarios' },
      { name: 'roles', description: 'Gestion de roles' },
      { name: 'permissions', description: 'Catalogo de permisos (solo lectura)' },
      { name: 'audit', description: 'Registro de auditoria' },
      { name: 'alerts', description: 'Alertas operativas y sus reglas' },
      { name: 'assistant', description: 'Asistente de IA' },
      { name: 'dashboard', description: 'Panel general del hospital' },
      { name: 'analytics', description: 'Analitica e indicadores' },
      { name: 'medications', description: 'Medicamentos, insumos y stock' },
      { name: 'surgeries', description: 'Cirugias programadas' },
      { name: 'health', description: 'Sondas de salud' },
    ],
    paths,
  };
}

/** Se exporta para el test que verifica que el contrato se genera sin romperse. */
export { aJsonSchema, z };
