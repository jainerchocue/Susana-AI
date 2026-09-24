import { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { env } from '../../config/env';
import { AppError } from '../../core/http/errors';
import type { ApiFieldError } from '../../core/http/api-response';
import type { Dataset } from './assistant.catalog';
import type { QuerySpec } from './assistant.schemas';

/**
 * Validacion semantica del DSL contra el catalogo del usuario, y construccion
 * del SQL parametrizado que lo ejecuta. Dos pasos separados a proposito:
 * `validarConsulta` decide si la consulta tiene sentido; `construirSql` nunca
 * decide nada, solo traduce una consulta YA VALIDADA a `Prisma.Sql`.
 *
 * Regla dura (CLAUDE.md §6): nunca `$queryRawUnsafe` ni concatenacion. Todo
 * identificador (tabla, columna, alias) sale del catalogo, ya verificado
 * contra `/^[A-Za-z_][A-Za-z0-9_]*$/` al cargar `assistant.catalog.ts`. Todo
 * valor que venga del DSL viaja como parametro `${}` de `Prisma.sql`.
 */

export interface ConsultaValidada {
  dataset: Dataset;
  spec: QuerySpec;
}

export interface ResultadoConsulta {
  columns: string[];
  rows: Record<string, string | number | boolean | null>[];
  rowCount: number;
  truncated: boolean;
}

type Filtro = QuerySpec['filters'][number];
type Metrica = QuerySpec['metrics'][number];

interface CampoInfo {
  tipo: 'string' | 'number' | 'date';
  clase: 'dimension' | 'measure';
  column: string;
  /** Solo dimensiones `date` sobre una columna `timestamptz` real (ver Dimension en assistant.catalog.ts). */
  zonaHoraria?: string;
}

function buscarCampo(dataset: Dataset, nombre: string): CampoInfo | null {
  const dimension = dataset.dimensions[nombre];
  if (dimension) {
    return { tipo: dimension.type, clase: 'dimension', column: dimension.column, zonaHoraria: dimension.zonaHoraria };
  }
  const medida = dataset.measures[nombre];
  if (medida) return { tipo: 'number', clase: 'measure', column: medida.column };
  return null;
}

// ── Validacion semantica ─────────────────────────────────────────────────────

function validarMetricas(dataset: Dataset, metrics: Metrica[], detalles: ApiFieldError[]): void {
  metrics.forEach((m, i) => {
    const base = `metrics.${i}.field`;
    if (m.agg === 'count') {
      if (m.field !== undefined) detalles.push({ field: base, message: '"count" no admite field.' });
      return;
    }
    if (m.field === undefined) {
      detalles.push({ field: base, message: `"${m.agg}" exige field.` });
      return;
    }
    const campo = buscarCampo(dataset, m.field);
    if (!campo) {
      detalles.push({ field: base, message: `Campo desconocido: ${m.field}.` });
      return;
    }
    if (m.agg === 'count_distinct' && campo.clase !== 'dimension') {
      detalles.push({ field: base, message: '"count_distinct" exige una dimension.' });
    }
    if (m.agg !== 'count_distinct' && campo.clase !== 'measure') {
      detalles.push({ field: base, message: `"${m.agg}" exige una medida.` });
    }
  });
}

function validarGroupBy(dataset: Dataset, groupBy: QuerySpec['groupBy'], detalles: ApiFieldError[]): void {
  groupBy.forEach((g, i) => {
    const campo = buscarCampo(dataset, g.field);
    if (!campo || campo.clase !== 'dimension') {
      detalles.push({ field: `groupBy.${i}.field`, message: `Campo de agrupacion desconocido: ${g.field}.` });
      return;
    }
    if (g.grain && campo.tipo !== 'date') {
      detalles.push({ field: `groupBy.${i}.grain`, message: 'El grain solo se aplica a dimensiones de fecha.' });
    }
  });
}

function esFechaValida(valor: unknown): boolean {
  return typeof valor === 'string' && !Number.isNaN(Date.parse(valor));
}

const OPS_SOLO_ORDEN = new Set(['gt', 'gte', 'lt', 'lte', 'between']);

/** ¿El operador es compatible con el TIPO del campo? Independiente de la forma del valor. */
function validarOperadorVsTipo(campo: CampoInfo, f: Filtro, base: string, detalles: ApiFieldError[]): void {
  if (f.op === 'contains' && campo.tipo !== 'string') {
    detalles.push({ field: `${base}.op`, message: '"contains" solo se aplica a campos de texto.' });
  }
  if (OPS_SOLO_ORDEN.has(f.op) && campo.tipo === 'string') {
    detalles.push({ field: `${base}.op`, message: `"${f.op}" no se aplica a campos de texto.` });
  }
}

/** ¿El VALOR tiene la forma que su operador exige (array de 2, array, ...)? */
function validarFormaValor(f: Filtro, base: string, detalles: ApiFieldError[]): void {
  if (f.op === 'between' && (!Array.isArray(f.value) || f.value.length !== 2)) {
    detalles.push({ field: `${base}.value`, message: '"between" exige un array de 2 valores.' });
  }
  if (f.op === 'in' && !Array.isArray(f.value)) {
    detalles.push({ field: `${base}.value`, message: '"in" exige un array de valores.' });
  }
}

type TipoJs = 'string' | 'number' | 'boolean' | 'otro';

function tipoDeValor(v: unknown): TipoJs {
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'otro';
}

/**
 * El TIPO del valor debe casar con el TIPO del campo: sin esto, un filtro mal
 * tipado (p. ej. un numero contra una dimension de texto) llega a Postgres y
 * revienta con un 500 en vez de un 422 (hallazgo de la revision de seguridad).
 * El catalogo no tiene campos booleanos: un valor booleano se rechaza SIEMPRE,
 * case con lo que case el campo. Un array con tipos mezclados tambien se
 * rechaza: `= ANY(...)` y `BETWEEN` exigen un tipo uniforme.
 */
function validarTipoValor(campo: CampoInfo, f: Filtro, base: string, detalles: ApiFieldError[]): void {
  const valores = Array.isArray(f.value) ? f.value : [f.value];
  const tipos = new Set(valores.map(tipoDeValor));

  if (tipos.size > 1) {
    detalles.push({ field: `${base}.value`, message: 'Todos los valores del array deben ser del mismo tipo.' });
    return;
  }
  const [tipoValor] = tipos;

  if (tipoValor === 'boolean' || tipoValor === 'otro') {
    detalles.push({ field: `${base}.value`, message: 'El catalogo no tiene campos booleanos.' });
    return;
  }
  if (campo.tipo === 'number' && tipoValor !== 'number') {
    detalles.push({ field: `${base}.value`, message: 'Este campo es numerico: el valor debe ser un numero.' });
  } else if (campo.tipo === 'string' && tipoValor !== 'string') {
    detalles.push({ field: `${base}.value`, message: 'Este campo es de texto: el valor debe ser una cadena.' });
  } else if (campo.tipo === 'date' && (tipoValor !== 'string' || valores.some((v) => !esFechaValida(v)))) {
    detalles.push({ field: `${base}.value`, message: 'Valor de fecha invalido (usa ISO 8601).' });
  }
}

function validarFiltro(dataset: Dataset, f: Filtro, indice: number, detalles: ApiFieldError[]): void {
  const base = `filters.${indice}`;
  const campo = buscarCampo(dataset, f.field);
  if (!campo) {
    detalles.push({ field: `${base}.field`, message: `Campo desconocido: ${f.field}.` });
    return;
  }

  validarOperadorVsTipo(campo, f, base, detalles);
  validarFormaValor(f, base, detalles);
  validarTipoValor(campo, f, base, detalles);
}

/**
 * Metricas con el mismo (agg, field) o campos repetidos en groupBy producen
 * el MISMO alias de columna: la segunda pisa a la primera en silencio y una
 * columna entera desaparece del resultado sin que nadie se entere.
 */
function validarDuplicados(spec: QuerySpec, detalles: ApiFieldError[]): void {
  const metricasVistas = new Map<string, number>();
  spec.metrics.forEach((m, i) => {
    const clave = `${m.agg}:${m.field ?? ''}`;
    const previo = metricasVistas.get(clave);
    if (previo === undefined) {
      metricasVistas.set(clave, i);
      return;
    }
    detalles.push({
      field: `metrics.${i}`,
      message: `Metrica repetida (mismo agg y field que metrics.${previo}): sus alias chocarian.`,
    });
  });

  const camposVistos = new Map<string, number>();
  spec.groupBy.forEach((g, i) => {
    const previo = camposVistos.get(g.field);
    if (previo === undefined) {
      camposVistos.set(g.field, i);
      return;
    }
    detalles.push({ field: `groupBy.${i}.field`, message: `Campo repetido: ya esta en groupBy.${previo}.` });
  });
}

function validarOrderBy(spec: QuerySpec, detalles: ApiFieldError[]): void {
  const camposGroupBy = new Set(spec.groupBy.map((g) => g.field));
  spec.orderBy.forEach((o, i) => {
    const base = `orderBy.${i}.ref`;
    const metrica = /^metric:(\d+)$/.exec(o.ref);
    if (metrica) {
      if (Number(metrica[1]) >= spec.metrics.length) {
        detalles.push({ field: base, message: `No existe la metrica ${metrica[1] ?? ''}.` });
      }
      return;
    }
    if (!camposGroupBy.has(o.ref)) {
      detalles.push({ field: base, message: `"${o.ref}" no esta en groupBy.` });
    }
  });
}

/**
 * Valida la consulta contra los datasets YA FILTRADOS por permisos del actor
 * (del usuario dueño del ticket, no de quien la ejecuta). Si algo falla,
 * `AppError.queryRejected` con el detalle campo a campo.
 */
export function validarConsulta(spec: QuerySpec, datasets: Dataset[], maxRows: number): ConsultaValidada {
  const dataset = datasets.find((d) => d.key === spec.dataset);
  if (!dataset) {
    // Mismo mensaje si el dataset no existe o si el usuario no tiene su
    // permiso: no hay que confirmarle a quien pregunta cual es cual (§0).
    throw AppError.queryRejected('Dataset desconocido o no permitido.', [
      { field: 'dataset', message: 'Dataset desconocido o no permitido.' },
    ]);
  }

  const detalles: ApiFieldError[] = [];
  validarMetricas(dataset, spec.metrics, detalles);
  validarGroupBy(dataset, spec.groupBy, detalles);
  spec.filters.forEach((f, i) => { validarFiltro(dataset, f, i, detalles); });
  validarOrderBy(spec, detalles);
  validarDuplicados(spec, detalles);
  if (spec.limit > maxRows) {
    detalles.push({ field: 'limit', message: `El limite maximo es ${maxRows}.` });
  }

  if (detalles.length > 0) {
    throw AppError.queryRejected('La consulta propuesta no es valida.', detalles);
  }
  return { dataset, spec };
}

// ── Construccion del SQL ─────────────────────────────────────────────────────

/** Unico punto que produce un identificador SQL crudo: siempre via `Prisma.raw`, nunca concatenado en un valor. */
function columna(nombre: string): Prisma.Sql {
  return Prisma.raw(`"${nombre}"`);
}

function expresionDimension(campo: CampoInfo, grain?: string): Prisma.Sql {
  if (grain) {
    // El grain y la zona horaria viajan como PARAMETROS: date_trunc y AT TIME
    // ZONE aceptan el nombre de la unidad/zona como texto. Solo se convierte
    // a `campo.zonaHoraria` cuando la columna es timestamptz de verdad (HIS):
    // sin esta conversion, el corte de "dia" lo decide el timezone de SESION
    // de Postgres (no fiable entre entornos, verificado contra Postgres real).
    const expresion = campo.zonaHoraria
      ? Prisma.sql`(${columna(campo.column)} AT TIME ZONE ${campo.zonaHoraria})`
      : columna(campo.column);
    return Prisma.sql`date_trunc(${grain}, ${expresion})`;
  }
  // Los enums de Postgres (severity, status...) se marcan como dimension de
  // tipo 'string' en el catalogo: el cast a texto es lo que permite compararlos
  // con un parametro de texto sin que Postgres se queje del tipo.
  return campo.tipo === 'string' ? Prisma.sql`${columna(campo.column)}::text` : columna(campo.column);
}

function expresionAgregado(dataset: Dataset, m: Metrica): Prisma.Sql {
  if (m.agg === 'count') return Prisma.sql`COUNT(*)::int`;

  const nombreCampo = m.field!; // validarConsulta ya exige field cuando agg !== 'count'
  const campo = buscarCampo(dataset, nombreCampo)!; // ...y que exista en el catalogo
  const col = columna(campo.column);
  switch (m.agg) {
    case 'count_distinct':
      return Prisma.sql`COUNT(DISTINCT ${col})::int`;
    case 'sum':
      return Prisma.sql`SUM(${col})::float8`;
    case 'avg':
      return Prisma.sql`AVG(${col})::float8`;
    case 'min':
      return Prisma.sql`MIN(${col})`;
    default:
      return Prisma.sql`MAX(${col})`;
  }
}

/** Escapa `\`, `%` y `_` para que `contains` no se convierta en un comodin sin querer. */
function escaparLike(valor: string): string {
  return valor.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Un campo de fecha viaja como ISO string en el DSL, pero se convierte a
 * `Date` real ANTES de vincularlo como parametro: asi node-postgres lo
 * serializa como un timestamp, y Postgres compara timestamp con timestamp en
 * vez de timestamp con un literal de texto (hallazgo de la revision de
 * seguridad). Para el resto de tipos el valor pasa sin tocar.
 */
function valorEscalar(campo: CampoInfo, valor: Filtro['value'] | string | number): unknown {
  return campo.tipo === 'date' && typeof valor === 'string' ? new Date(valor) : valor;
}

function condicionFiltro(dataset: Dataset, f: Filtro): Prisma.Sql {
  const campo = buscarCampo(dataset, f.field)!; // ya validado por validarConsulta
  const col = campo.tipo === 'string' ? Prisma.sql`${columna(campo.column)}::text` : columna(campo.column);

  switch (f.op) {
    case 'eq':
      return Prisma.sql`${col} = ${valorEscalar(campo, f.value)}`;
    case 'neq':
      return Prisma.sql`${col} != ${valorEscalar(campo, f.value)}`;
    case 'gt':
      return Prisma.sql`${col} > ${valorEscalar(campo, f.value)}`;
    case 'gte':
      return Prisma.sql`${col} >= ${valorEscalar(campo, f.value)}`;
    case 'lt':
      return Prisma.sql`${col} < ${valorEscalar(campo, f.value)}`;
    case 'lte':
      return Prisma.sql`${col} <= ${valorEscalar(campo, f.value)}`;
    case 'between': {
      if (!Array.isArray(f.value) || f.value.length !== 2) {
        // Defensa en profundidad: validarConsulta ya lo exige. No deberia llegar aqui.
        throw AppError.internal('Filtro "between" mal formado.');
      }
      // noUncheckedIndexedAccess marcaria esto como "podria faltar", pero el
      // `.length !== 2` de arriba ya lo garantiza.
      const desde = f.value[0]!;
      const hasta = f.value[1]!;
      return Prisma.sql`${col} BETWEEN ${valorEscalar(campo, desde)} AND ${valorEscalar(campo, hasta)}`;
    }
    case 'in': {
      if (!Array.isArray(f.value)) throw AppError.internal('Filtro "in" mal formado.');
      return Prisma.sql`${col} = ANY(${f.value.map((v) => valorEscalar(campo, v))})`;
    }
    default: {
      // "contains" solo es semanticamente valido sobre campos de texto (ya lo
      // exige validarConsulta); el valor deberia ser siempre string, pero se
      // evita `String(obj)` -> "[object Object]" por si acaso.
      const texto = typeof f.value === 'string' ? f.value : JSON.stringify(f.value);
      return Prisma.sql`${col} ILIKE ${`%${escaparLike(texto)}%`}`;
    }
  }
}

function construirOrderBy(spec: QuerySpec): Prisma.Sql {
  if (spec.orderBy.length === 0) return Prisma.empty;
  const partes = spec.orderBy.map((o) => {
    const metrica = /^metric:(\d+)$/.exec(o.ref);
    const ordinal = metrica
      ? spec.groupBy.length + Number(metrica[1]) + 1
      : spec.groupBy.findIndex((g) => g.field === o.ref) + 1;
    // ordinal y direccion son numeros/literales generados por el codigo, nunca texto del DSL.
    return `${ordinal} ${o.dir === 'asc' ? 'ASC' : 'DESC'}`;
  });
  return Prisma.sql`ORDER BY ${Prisma.raw(partes.join(', '))}`;
}

/**
 * Traduce una consulta YA VALIDADA a `Prisma.Sql`. GROUP BY y ORDER BY van por
 * posicion ordinal (numeros que genera este mismo codigo): repetir la misma
 * expresion de SELECT en el GROUP BY no siempre casa en Postgres cuando lleva
 * un parametro (p. ej. `date_trunc($1, "col")` dos veces con distinto $N).
 */
export function construirSql(c: ConsultaValidada, permisos: ReadonlySet<string>): Prisma.Sql {
  const { dataset, spec } = c;

  const selectGroupBy = spec.groupBy.map((g) => {
    const campo = buscarCampo(dataset, g.field)!; // ya validado
    return Prisma.sql`${expresionDimension(campo, g.grain)} AS ${columna(g.field)}`;
  });
  const selectMetrics = spec.metrics.map((m) => {
    const alias = `${m.agg}_${m.field ?? 'all'}`;
    return Prisma.sql`${expresionAgregado(dataset, m)} AS ${columna(alias)}`;
  });

  const condiciones = spec.filters.map((f) => condicionFiltro(dataset, f));
  if (dataset.rowFilter) {
    const permitidos = dataset.rowFilter.permitidos(permisos);
    const col = Prisma.sql`${columna(dataset.rowFilter.column)}::text`;
    // Alcance vacio: nadie ve nada de este dataset. No es un caso de error,
    // es la fila que corresponde: `alcancesPorPermiso` ya lo decidio antes.
    condiciones.push(permitidos.length > 0 ? Prisma.sql`${col} = ANY(${permitidos})` : Prisma.sql`FALSE`);
  }
  const where = condiciones.length > 0 ? Prisma.sql`WHERE ${Prisma.join(condiciones, ' AND ')}` : Prisma.empty;

  const groupBy =
    spec.groupBy.length > 0
      ? Prisma.sql`GROUP BY ${Prisma.raw(spec.groupBy.map((_, i) => String(i + 1)).join(', '))}`
      : Prisma.empty;

  const selectList = Prisma.join([...selectGroupBy, ...selectMetrics], ', ');
  return Prisma.sql`SELECT ${selectList} FROM ${columna(dataset.table)} ${where} ${groupBy} ${construirOrderBy(spec)} LIMIT ${spec.limit + 1}`;
}

// ── Ejecucion ────────────────────────────────────────────────────────────────

function columnasEsperadas(spec: QuerySpec): string[] {
  return [...spec.groupBy.map((g) => g.field), ...spec.metrics.map((m) => `${m.agg}_${m.field ?? 'all'}`)];
}

function normalizarValor(valor: unknown): string | number | boolean | null {
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'bigint') return Number(valor);
  if (valor === null || typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') {
    return valor;
  }
  // Tipo inesperado en una fila de Postgres (no deberia pasar: el catalogo solo
  // expone texto/numero/fecha). `JSON.stringify` en vez de `String()`: evita
  // "[object Object]" si alguna vez es de verdad un objeto.
  return JSON.stringify(valor);
}

function normalizarFila(fila: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const normalizada: Record<string, string | number | boolean | null> = {};
  for (const [clave, valor] of Object.entries(fila)) normalizada[clave] = normalizarValor(valor);
  return normalizada;
}

/**
 * Ejecuta en una transaccion de solo lectura con `statement_timeout` propio.
 * `SET TRANSACTION READ ONLY` va como PRIMERA sentencia: Postgres exige que
 * las caracteristicas de la transaccion se fijen antes de la primera consulta.
 * El timeout de la transaccion de Prisma (`AGENT_QUERY_TIMEOUT_MS + 1000`)
 * da margen a que el `statement_timeout` de Postgres actue primero y devuelva
 * un error mas especifico.
 */
export async function ejecutarConsulta(
  c: ConsultaValidada,
  permisos: ReadonlySet<string>,
): Promise<ResultadoConsulta> {
  const sql = construirSql(c, permisos);

  const filas = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(env.AGENT_QUERY_TIMEOUT_MS)}, true)`;
      return tx.$queryRaw<Record<string, unknown>[]>(sql);
    },
    { timeout: env.AGENT_QUERY_TIMEOUT_MS + 1000 },
  );

  const truncated = filas.length > c.spec.limit;
  const recortadas = (truncated ? filas.slice(0, c.spec.limit) : filas).map(normalizarFila);

  return { columns: columnasEsperadas(c.spec), rows: recortadas, rowCount: recortadas.length, truncated };
}
