import { z, type ZodTypeAny } from 'zod';
import { env } from '../../config/env';
import { BRAND } from '../../config/constants';
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

/**
 * Conversor Zod -> JSON Schema para los constructores que emplea el proyecto.
 * Zod 4 trae `z.toJSONSchema()` nativo: al migrar, esta funcion se sustituye
 * por esa llamada y se borra.
 */
function aJsonSchema(schema: ZodTypeAny): JsonSchema {
  const def = schema._def as { typeName?: string; [k: string]: unknown };
  const tipo = def.typeName;

  switch (tipo) {
    case 'ZodString': {
      const checks = (def.checks ?? []) as { kind: string; value?: number }[];
      const salida: JsonSchema = { type: 'string' };
      for (const c of checks) {
        if (c.kind === 'min') salida.minLength = c.value;
        if (c.kind === 'max') salida.maxLength = c.value;
        if (c.kind === 'email') salida.format = 'email';
        if (c.kind === 'uuid') salida.format = 'uuid';
        if (c.kind === 'url') salida.format = 'uri';
      }
      return salida;
    }
    case 'ZodNumber':
      return { type: 'number' };
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
    case 'ZodObject': {
      const shape = (def.shape as () => Record<string, ZodTypeAny>)();
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
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodCatch':
      return aJsonSchema(def.innerType as ZodTypeAny);
    case 'ZodEffects':
      return aJsonSchema(def.schema as ZodTypeAny);
    case 'ZodPipeline':
      return aJsonSchema(def.out as ZodTypeAny);
    case 'ZodUnion':
      return { anyOf: (def.options as ZodTypeAny[]).map(aJsonSchema) };
    case 'ZodRecord':
      return { type: 'object', additionalProperties: true };
    default:
      return {};
  }
}

const RESPUESTA_ERROR: JsonSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', const: false },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
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
    meta: {
      type: 'object',
      properties: { requestId: { type: 'string' }, timestamp: { type: 'string', format: 'date-time' } },
    },
  },
  required: ['success', 'error', 'meta'],
};

function respuestaExito(dataSchema?: ZodTypeAny): JsonSchema {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean', const: true },
      data: dataSchema ? aJsonSchema(dataSchema) : { type: 'object' },
      meta: {
        type: 'object',
        properties: { requestId: { type: 'string' }, timestamp: { type: 'string', format: 'date-time' } },
      },
    },
    required: ['success', 'data', 'meta'],
  };
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

  return {
    summary: ruta.summary,
    description: ruta.description,
    tags: [ruta.tag],
    ...(ruta.auth ? { security: [{ bearerAuth: [] }] } : {}),
    ...(parametros.length > 0 ? { parameters: parametros } : {}),
    ...(ruta.body
      ? { requestBody: { required: true, content: { 'application/json': { schema: aJsonSchema(ruta.body) } } } }
      : {}),
    responses: {
      [String(ruta.status ?? 200)]: {
        description: 'Operacion correcta',
        content: { 'application/json': { schema: respuestaExito(ruta.response) } },
      },
      '400': { description: 'Peticion invalida', content: { 'application/json': { schema: RESPUESTA_ERROR } } },
      '401': { description: 'No autenticado', content: { 'application/json': { schema: RESPUESTA_ERROR } } },
      '403': { description: 'Permisos insuficientes', content: { 'application/json': { schema: RESPUESTA_ERROR } } },
      '422': { description: 'Validacion fallida', content: { 'application/json': { schema: RESPUESTA_ERROR } } },
      '429': { description: 'Demasiadas peticiones', content: { 'application/json': { schema: RESPUESTA_ERROR } } },
    },
  };
}

export function construirOpenApi(): JsonSchema {
  const paths: Record<string, JsonSchema> = {};

  for (const ruta of registroOpenApi) {
    // OpenAPI usa {id}; Express usa :id.
    const ruteo = `${env.API_PREFIX}${ruta.path.replace(/:(\w+)/g, '{$1}')}`;
    paths[ruteo] ??= {};
    (paths[ruteo] as Record<string, unknown>)[ruta.method] = construirOperacion(ruta);
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
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    tags: [
      { name: 'auth', description: 'Registro, sesion, MFA y OAuth' },
      { name: 'users', description: 'Gestion de usuarios' },
      { name: 'roles', description: 'Gestion de roles' },
      { name: 'permissions', description: 'Catalogo de permisos' },
      { name: 'audit', description: 'Registro de auditoria' },
      { name: 'health', description: 'Sondas de salud' },
    ],
    paths,
  };
}

/** Se exporta para el test que verifica que el contrato se genera sin romperse. */
export { aJsonSchema, z };
