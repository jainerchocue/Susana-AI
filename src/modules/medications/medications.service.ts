import { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { env } from '../../config/env';
import { AppError } from '../../core/http/errors';
import { AUDIT, auditarEnTx, type RequestMeta } from '../../core/audit/audit';
import { HIS_ZONA_HORARIA, fechaReferencia, resolverPeriodo } from '../his/his.periodo';
import { recalcularDerivados } from '../his/his.derivados';
import type {
  ConsumptionQuery,
  CreateDispenseInput,
  CreateMedicationInput,
  ListDispensesQuery,
  ListMedicationsQuery,
  ListStockQuery,
  UpdateDispenseInput,
  UpdateMedicationInput,
} from './medications.schemas';

/**
 * Medicamentos e insumos (T9). B0: el HIS no trae stock, asi que todo lo que
 * depende de el (dias de inventario, riesgo, rotacion) es `'insufficient_data'`
 * hasta que FARMACIA lo registre por API (`PUT /:code/stock`).
 */

const DIAS_CONSUMO_MEDIO = 30;
const TOP_CONSUMO = 10;

type Riesgo = 'CRITICAL' | 'LOW' | 'OK' | 'insufficient_data';

function redondear(valor: number, decimales = 3): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

/**
 * Escapa los metacaracteres de LIKE/ILIKE (`\`, `%`, `_`) para que el termino
 * de busqueda se compare literal, no como patron ("ILIKE escapado", T9).
 * Postgres usa `\` como caracter de escape por defecto en LIKE/ILIKE, asi que
 * no hace falta una clausula ESCAPE explicita.
 */
function escaparComodinesLike(valor: string): string {
  return valor.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function evaluarRiesgo(dias: number | 'insufficient_data'): Riesgo {
  if (dias === 'insufficient_data') return 'insufficient_data';
  if (dias < env.ALERT_CRITICAL_STOCK_DAYS) return 'CRITICAL';
  if (dias < env.ALERT_LOW_STOCK_DAYS) return 'LOW';
  return 'OK';
}

/** Cantidad total de los ultimos 30 dias hasta `referencia`, por codigo. */
async function consumoMedioDiario(codes: string[], referencia: Date): Promise<Map<string, number>> {
  if (codes.length === 0) return new Map();
  const desde = new Date(referencia.getTime() - DIAS_CONSUMO_MEDIO * 24 * 60 * 60 * 1000);
  const grupos = await prisma.medicationDispense.groupBy({
    by: ['code'],
    where: { code: { in: codes }, dispensedAt: { gte: desde, lte: referencia } },
    _sum: { quantity: true },
  });
  const mapa = new Map<string, number>();
  for (const g of grupos) mapa.set(g.code, (g._sum.quantity ?? 0) / DIAS_CONSUMO_MEDIO);
  return mapa;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /medications
// ─────────────────────────────────────────────────────────────────────────────

export interface MedicationListItem {
  code: string;
  name: string;
  kind: string;
  /** Cantidad dispensada en el periodo (`desde`/`hasta` de la query). */
  quantity: number;
  /** Numero de dispensaciones (lineas) en el periodo. */
  lines: number;
  /** Ultima dispensacion registrada, sea cual sea el periodo consultado. */
  lastDispensedAt: string | null;
  stock: number | null;
  avgDailyConsumption: number | 'insufficient_data';
  daysOfInventory: number | 'insufficient_data';
  risk: Riesgo;
  /** Exige historico de stock, que no existe: siempre 'insufficient_data' (B0). */
  rotation: 'insufficient_data';
}

export interface ListMedicationsResult {
  items: MedicationListItem[];
  total: number;
  page: number;
  limit: number;
}

async function agregadoPeriodo(
  codes: string[],
  desde: Date,
  hasta: Date,
): Promise<Map<string, { quantity: number; lines: number }>> {
  if (codes.length === 0) return new Map();
  const grupos = await prisma.medicationDispense.groupBy({
    by: ['code'],
    where: { code: { in: codes }, dispensedAt: { gte: desde, lte: hasta } },
    _sum: { quantity: true },
    _count: { _all: true },
  });
  return new Map(grupos.map((g) => [g.code, { quantity: g._sum.quantity ?? 0, lines: g._count._all }]));
}

async function ultimaDispensacion(codes: string[]): Promise<Map<string, Date>> {
  if (codes.length === 0) return new Map();
  const grupos = await prisma.medicationDispense.groupBy({
    by: ['code'],
    where: { code: { in: codes } },
    _max: { dispensedAt: true },
  });
  const mapa = new Map<string, Date>();
  for (const g of grupos) if (g._max.dispensedAt) mapa.set(g.code, g._max.dispensedAt);
  return mapa;
}

export async function list(query: ListMedicationsQuery): Promise<ListMedicationsResult> {
  const { desde, hasta } = await resolverPeriodo(query, 30);

  const where: Prisma.MedicationWhereInput = {};
  if (query.kind) where.kind = query.kind;
  if (query.search) where.name = { contains: escaparComodinesLike(query.search), mode: 'insensitive' };

  const [total, medicamentos] = await Promise.all([
    prisma.medication.count({ where }),
    prisma.medication.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  const codes = medicamentos.map((m) => m.code);
  const [periodo, ultimaGlobal, stocks, referencia] = await Promise.all([
    agregadoPeriodo(codes, desde, hasta),
    ultimaDispensacion(codes),
    prisma.medicationStock.findMany({ where: { code: { in: codes } } }),
    fechaReferencia(),
  ]);
  const consumo = await consumoMedioDiario(codes, referencia);
  const stockPorCodigo = new Map(stocks.map((s) => [s.code, s.quantity]));

  const items: MedicationListItem[] = medicamentos.map((m) => {
    const agg = periodo.get(m.code);
    const stock = stockPorCodigo.get(m.code) ?? null;

    // Sin stock registrado, ni el consumo medio importa (T9: "todos
    // insufficient_data sin stock"): no hay contra que dividir.
    let avg: number | 'insufficient_data' = 'insufficient_data';
    let dias: number | 'insufficient_data' = 'insufficient_data';
    if (stock !== null) {
      const c = consumo.get(m.code) ?? 0;
      avg = redondear(c);
      dias = c > 0 ? redondear(stock / c, 1) : 'insufficient_data';
    }

    return {
      code: m.code,
      name: m.name,
      kind: m.kind,
      quantity: agg?.quantity ?? 0,
      lines: agg?.lines ?? 0,
      lastDispensedAt: ultimaGlobal.get(m.code)?.toISOString() ?? null,
      stock,
      avgDailyConsumption: avg,
      daysOfInventory: dias,
      risk: evaluarRiesgo(dias),
      rotation: 'insufficient_data',
    };
  });

  return { items, total, page: query.page, limit: query.limit };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /medications/critical
// ─────────────────────────────────────────────────────────────────────────────

export interface CriticalMedicationItem {
  code: string;
  name: string;
  kind: string | null;
  stock: number;
  avgDailyConsumption: number;
  daysOfInventory: number;
  risk: 'CRITICAL' | 'LOW';
}

export type CriticalMedicationsResult =
  | { status: 'ok'; items: CriticalMedicationItem[] }
  | { status: 'insufficient_data'; reason: string; items: [] };

export async function critical(): Promise<CriticalMedicationsResult> {
  const stocks = await prisma.medicationStock.findMany();
  if (stocks.length === 0) {
    return {
      status: 'insufficient_data',
      reason: 'No hay stock registrado para ningun medicamento.',
      items: [],
    };
  }

  const referencia = await fechaReferencia();
  const codes = stocks.map((s) => s.code);
  const [consumo, medicamentos] = await Promise.all([
    consumoMedioDiario(codes, referencia),
    prisma.medication.findMany({ where: { code: { in: codes } } }),
  ]);
  const medPorCodigo = new Map(medicamentos.map((m) => [m.code, m]));

  const items: CriticalMedicationItem[] = [];
  for (const stock of stocks) {
    const avg = consumo.get(stock.code) ?? 0;
    const dias = avg > 0 ? redondear(stock.quantity / avg, 1) : 'insufficient_data';
    const riesgo = evaluarRiesgo(dias);
    if (riesgo !== 'CRITICAL' && riesgo !== 'LOW') continue;

    const medicamento = medPorCodigo.get(stock.code);
    items.push({
      code: stock.code,
      name: medicamento?.name ?? stock.code,
      kind: medicamento?.kind ?? null,
      stock: stock.quantity,
      avgDailyConsumption: redondear(avg),
      // `dias` es numero aqui: `riesgo` ya descarto 'insufficient_data' arriba.
      daysOfInventory: dias as number,
      risk: riesgo,
    });
  }

  items.sort((a, b) => a.daysOfInventory - b.daysOfInventory);
  return { status: 'ok', items };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /medications/consumption
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsumptionResult {
  desde: string;
  hasta: string;
  grain: 'day' | 'week';
  code: string | null;
  series: Array<{ date: string; quantity: number }>;
  top: Array<{ code: string; name: string; quantity: number }>;
  byArea: Array<{ area: string; quantity: number }>;
}

interface FilaSerie {
  bucket: Date;
  quantity: number;
}

export async function consumption(query: ConsumptionQuery): Promise<ConsumptionResult> {
  const { desde, hasta } = await resolverPeriodo(query, 30);
  const filtroCodigo = query.code ? Prisma.sql`AND code = ${query.code}` : Prisma.empty;

  // `grain` y la zona horaria viajan como parametros de `date_trunc`/`AT TIME
  // ZONE`, nunca concatenados (CLAUDE.md §6), igual que en assistant.query.ts.
  const filasSerie = await prisma.$queryRaw<FilaSerie[]>(Prisma.sql`
    SELECT date_trunc(${query.grain}, ("dispensedAt" AT TIME ZONE ${HIS_ZONA_HORARIA})) AS bucket,
           SUM(quantity)::int AS quantity
    FROM his_medication_dispenses
    WHERE "dispensedAt" BETWEEN ${desde} AND ${hasta}
    ${filtroCodigo}
    GROUP BY bucket
    ORDER BY bucket ASC
  `);

  // El top-10 es global al periodo, aunque se filtre `code` para la serie: no
  // tiene sentido un "top 10" de un unico codigo.
  const topGrupos = await prisma.medicationDispense.groupBy({
    by: ['code'],
    where: { dispensedAt: { gte: desde, lte: hasta } },
    _sum: { quantity: true },
  });
  const nombres = await prisma.medication.findMany({ where: { code: { in: topGrupos.map((g) => g.code) } } });
  const nombrePorCodigo = new Map(nombres.map((m) => [m.code, m.name]));
  const top = topGrupos
    .map((g) => ({ code: g.code, name: nombrePorCodigo.get(g.code) ?? g.code, quantity: g._sum.quantity ?? 0 }))
    .sort((a, b) => b.quantity - a.quantity || a.code.localeCompare(b.code))
    .slice(0, TOP_CONSUMO);

  const areaWhere: Prisma.MedicationDispenseWhereInput = { dispensedAt: { gte: desde, lte: hasta } };
  if (query.code) areaWhere.code = query.code;
  const areaGrupos = await prisma.medicationDispense.groupBy({
    by: ['area'],
    where: areaWhere,
    _sum: { quantity: true },
  });
  const byArea = areaGrupos
    .map((g) => ({ area: g.area, quantity: g._sum.quantity ?? 0 }))
    .sort((a, b) => b.quantity - a.quantity || a.area.localeCompare(b.area));

  return {
    desde: desde.toISOString(),
    hasta: hasta.toISOString(),
    grain: query.grain,
    code: query.code ?? null,
    series: filasSerie.map((f) => ({ date: f.bucket.toISOString(), quantity: f.quantity })),
    top,
    byArea,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /medications/:code/stock
// ─────────────────────────────────────────────────────────────────────────────

export interface StockActualizado {
  code: string;
  quantity: number;
  updatedAt: string;
}

export async function updateStock(
  code: string,
  quantity: number,
  actorId: string,
  meta: RequestMeta,
): Promise<StockActualizado> {
  const actualizado = await prisma.$transaction(async (tx) => {
    const anterior = await tx.medicationStock.findUnique({ where: { code } });
    const fila = await tx.medicationStock.upsert({
      where: { code },
      create: { code, quantity, updatedBy: actorId },
      update: { quantity, updatedBy: actorId },
    });
    // targetId es @db.Uuid en AuditLog: `code` no lo es, asi que viaja en
    // `metadata`, no en targetId (que se deja vacio).
    await auditarEnTx(tx, {
      action: AUDIT.stockActualizado,
      actorId,
      targetType: 'medication_stock',
      metadata: { code, from: anterior?.quantity ?? null, to: quantity },
      ...meta,
    });
    return fila;
  });

  return { code: actualizado.code, quantity: actualizado.quantity, updatedAt: actualizado.updatedAt.toISOString() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Para T11 (motor de alertas): dias de inventario de todo lo que tiene stock.
// ─────────────────────────────────────────────────────────────────────────────

export async function diasInventario(
  referencia: Date,
): Promise<Array<{ code: string; name: string; daysOfInventory: number | 'insufficient_data' }>> {
  const stocks = await prisma.medicationStock.findMany();
  if (stocks.length === 0) return [];

  const codes = stocks.map((s) => s.code);
  const [consumo, medicamentos] = await Promise.all([
    consumoMedioDiario(codes, referencia),
    prisma.medication.findMany({ where: { code: { in: codes } } }),
  ]);
  const nombrePorCodigo = new Map(medicamentos.map((m) => [m.code, m.name]));

  return stocks.map((stock) => {
    const avg = consumo.get(stock.code) ?? 0;
    const dias = avg > 0 ? redondear(stock.quantity / avg, 1) : ('insufficient_data' as const);
    return { code: stock.code, name: nombrePorCodigo.get(stock.code) ?? stock.code, daysOfInventory: dias };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /medications/stock (TC4): lo ya registrado por FARMACIA, con su riesgo
// calculado. A diferencia de `critical()` (solo CRITICAL/LOW), aqui va TODO lo
// que tiene stock. El filtro `risk` depende de un campo CALCULADO (no de una
// columna): se trae la tabla completa (como `critical()`, unas pocas centenas
// de filas como mucho) y se pagina en memoria tras filtrar, no al reves -- lo
// contrario daria un `total`/paginas que no cuadran con el filtro.
// ─────────────────────────────────────────────────────────────────────────────

export interface StockListItem {
  code: string;
  name: string;
  kind: string;
  quantity: number;
  updatedAt: string;
  updatedBy: string | null;
  avgDailyConsumption: number | 'insufficient_data';
  daysOfInventory: number | 'insufficient_data';
  risk: Riesgo;
}

export interface ListStockResult {
  items: StockListItem[];
  total: number;
  page: number;
  limit: number;
}

export async function listStock(query: ListStockQuery): Promise<ListStockResult> {
  const stocks = await prisma.medicationStock.findMany({ orderBy: { code: 'asc' } });
  const codes = stocks.map((s) => s.code);
  const referencia = await fechaReferencia();
  const [consumo, medicamentos] = await Promise.all([
    consumoMedioDiario(codes, referencia),
    prisma.medication.findMany({ where: { code: { in: codes } } }),
  ]);
  const medPorCodigo = new Map(medicamentos.map((m) => [m.code, m]));

  const todos: StockListItem[] = stocks.map((stock) => {
    const avg = consumo.get(stock.code) ?? 0;
    const dias = avg > 0 ? redondear(stock.quantity / avg, 1) : ('insufficient_data' as const);
    const medicamento = medPorCodigo.get(stock.code);
    return {
      code: stock.code,
      name: medicamento?.name ?? stock.code,
      kind: medicamento?.kind ?? 'desconocido',
      quantity: stock.quantity,
      updatedAt: stock.updatedAt.toISOString(),
      updatedBy: stock.updatedBy,
      avgDailyConsumption: redondear(avg),
      daysOfInventory: dias,
      risk: evaluarRiesgo(dias),
    };
  });

  const filtrados = query.risk ? todos.filter((i) => i.risk === query.risk) : todos;
  const inicio = (query.page - 1) * query.limit;

  return { items: filtrados.slice(inicio, inicio + query.limit), total: filtrados.length, page: query.page, limit: query.limit };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /medications/:code (TC4): catalogo + stock + consumo de 30 dias + dias
// de inventario + riesgo. Reusa `consumoMedioDiario`/`ultimaDispensacion`
// (arriba): misma ventana y la misma logica que `list()`, sin duplicarla.
// ─────────────────────────────────────────────────────────────────────────────

export interface MedicationDetail {
  code: string;
  name: string;
  kind: string;
  stock: number | null;
  stockUpdatedAt: string | null;
  /** Cantidad dispensada en los ultimos 30 dias hasta la fecha de referencia. */
  consumption30d: number;
  avgDailyConsumption: number | 'insufficient_data';
  daysOfInventory: number | 'insufficient_data';
  risk: Riesgo;
  lastDispensedAt: string | null;
}

export async function getByCode(code: string): Promise<MedicationDetail> {
  const medicamento = await prisma.medication.findUnique({ where: { code } });
  if (!medicamento) throw AppError.notFound('Medicamento');

  const referencia = await fechaReferencia();
  const [stock, consumoMapa, ultimaMapa] = await Promise.all([
    prisma.medicationStock.findUnique({ where: { code } }),
    consumoMedioDiario([code], referencia),
    ultimaDispensacion([code]),
  ]);

  // Sin stock registrado, ni el consumo medio importa (T9): no hay contra que dividir.
  let avg: number | 'insufficient_data' = 'insufficient_data';
  let dias: number | 'insufficient_data' = 'insufficient_data';
  const consumoDiarioExacto = consumoMapa.get(code) ?? 0;
  if (stock) {
    avg = redondear(consumoDiarioExacto);
    dias = consumoDiarioExacto > 0 ? redondear(stock.quantity / consumoDiarioExacto, 1) : 'insufficient_data';
  }

  return {
    code: medicamento.code,
    name: medicamento.name,
    kind: medicamento.kind,
    stock: stock?.quantity ?? null,
    stockUpdatedAt: stock?.updatedAt.toISOString() ?? null,
    // Reconstruye el entero original (consumoMedioDiario ya lo dividio entre
    // 30): redondeo defensivo por el punto flotante de la division/producto.
    consumption30d: Math.round(consumoDiarioExacto * DIAS_CONSUMO_MEDIO),
    avgDailyConsumption: avg,
    daysOfInventory: dias,
    risk: evaluarRiesgo(dias),
    lastDispensedAt: ultimaMapa.get(code)?.toISOString() ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalogo: crear/editar/borrar (medications:manage, TC4).
// ─────────────────────────────────────────────────────────────────────────────

export interface MedicationCatalogEntry {
  code: string;
  name: string;
  kind: string;
}

async function getMedicationOrThrow(code: string) {
  const medicamento = await prisma.medication.findUnique({ where: { code } });
  if (!medicamento) throw AppError.notFound('Medicamento');
  return medicamento;
}

export async function createMedication(
  input: CreateMedicationInput,
  actorId: string,
  meta: RequestMeta,
): Promise<MedicationCatalogEntry> {
  const existente = await prisma.medication.findUnique({ where: { code: input.code } });
  if (existente) throw AppError.conflict(`Ya existe un medicamento con el codigo ${input.code}.`);

  const creado = await prisma.$transaction(async (tx) => {
    const fila = await tx.medication.create({ data: input });
    await auditarEnTx(tx, {
      action: AUDIT.registroCreado,
      actorId,
      targetType: 'medication',
      metadata: { code: fila.code, name: fila.name, kind: fila.kind },
      ...meta,
    });
    return fila;
  });

  return { code: creado.code, name: creado.name, kind: creado.kind };
}

export async function updateMedication(
  code: string,
  input: UpdateMedicationInput,
  actorId: string,
  meta: RequestMeta,
): Promise<MedicationCatalogEntry> {
  await getMedicationOrThrow(code);

  const actualizado = await prisma.$transaction(async (tx) => {
    const fila = await tx.medication.update({ where: { code }, data: input });
    await auditarEnTx(tx, {
      action: AUDIT.registroActualizado,
      actorId,
      targetType: 'medication',
      metadata: { code, cambios: Object.keys(input) },
      ...meta,
    });
    return fila;
  });

  return { code: actualizado.code, name: actualizado.name, kind: actualizado.kind };
}

/**
 * Borra un medicamento/insumo del catalogo. 409 si tiene dispensaciones o
 * stock: `MedicationDispense.code` SI tiene FK a `Medication` (fallaria solo en
 * la BD, con un P2003 generico), pero `MedicationStock.code` NO la tiene a
 * proposito (B0: FARMACIA puede registrar stock de un codigo sin dispensar
 * todavia) -- sin este chequeo explicito, borrar el medicamento dejaria el
 * stock huerfano sin que la BD se quejara.
 */
export async function removeMedication(code: string, actorId: string, meta: RequestMeta): Promise<void> {
  await getMedicationOrThrow(code);

  const [dispensaciones, stock] = await Promise.all([
    prisma.medicationDispense.count({ where: { code } }),
    prisma.medicationStock.findUnique({ where: { code } }),
  ]);

  const bloqueos: string[] = [];
  if (dispensaciones > 0) bloqueos.push(`${dispensaciones} dispensacion(es)`);
  if (stock) bloqueos.push('un registro de stock');
  if (bloqueos.length > 0) {
    throw AppError.conflict(`No se puede borrar "${code}": tiene ${bloqueos.join(' y ')}. Borralos primero.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.medication.delete({ where: { code } });
    await auditarEnTx(tx, {
      action: AUDIT.registroBorrado,
      actorId,
      targetType: 'medication',
      metadata: { code },
      ...meta,
    });
  });
}

/** DELETE /medications/:code/stock (medications:manage, TC4). */
export async function removeStock(code: string, actorId: string, meta: RequestMeta): Promise<void> {
  const existente = await prisma.medicationStock.findUnique({ where: { code } });
  if (!existente) throw AppError.notFound('Registro de stock');

  await prisma.$transaction(async (tx) => {
    await tx.medicationStock.delete({ where: { code } });
    // targetId es @db.Uuid: `code` no lo es, asi que viaja en `metadata` (mismo patron que `updateStock`).
    await auditarEnTx(tx, {
      action: AUDIT.stockBorrado,
      actorId,
      targetType: 'medication_stock',
      metadata: { code, from: existente.quantity },
      ...meta,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispensaciones: CRUD completo (/medications/dispenses[/:id], TC4). Escriben
// con data:manage; una dispensacion recalcula los derivados de SU ingreso
// (`recalcularDerivados` con filtro, nunca los ~18.000 restantes).
// ─────────────────────────────────────────────────────────────────────────────

export interface DispenseItem {
  id: number;
  admissionId: number;
  code: string;
  quantity: number;
  dispensedAt: string;
  area: string;
  specialty: string;
}

export interface ListDispensesResult {
  items: DispenseItem[];
  limit: number;
  nextCursor: number | null;
  hasNext: boolean;
}

interface FilaDispensacion {
  id: number;
  admissionId: number;
  code: string;
  quantity: number;
  dispensedAt: Date;
  area: string;
  specialty: string;
}

function aDispenseItem(fila: FilaDispensacion): DispenseItem {
  return {
    id: fila.id,
    admissionId: fila.admissionId,
    code: fila.code,
    quantity: fila.quantity,
    dispensedAt: fila.dispensedAt.toISOString(),
    area: fila.area,
    specialty: fila.specialty,
  };
}

export async function listDispenses(query: ListDispensesQuery): Promise<ListDispensesResult> {
  const where: Prisma.MedicationDispenseWhereInput = {};
  if (query.admissionId) where.admissionId = query.admissionId;
  if (query.code) where.code = query.code;
  if (query.area) where.area = query.area;
  if (query.specialty) where.specialty = query.specialty;
  if (query.desde || query.hasta) {
    where.dispensedAt = {
      ...(query.desde ? { gte: query.desde } : {}),
      ...(query.hasta ? { lte: query.hasta } : {}),
    };
  }

  // take + 1 para saber si hay siguiente sin contar la tabla entera (mismo patron que users.service#list).
  const filas = await prisma.medicationDispense.findMany({
    where,
    orderBy: { id: 'asc' },
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasNext = filas.length > query.limit;
  const pagina = hasNext ? filas.slice(0, query.limit) : filas;

  return {
    items: pagina.map(aDispenseItem),
    limit: query.limit,
    nextCursor: hasNext ? (pagina[pagina.length - 1]?.id ?? null) : null,
    hasNext,
  };
}

async function getDispenseOrThrow(id: number): Promise<FilaDispensacion> {
  const fila = await prisma.medicationDispense.findUnique({ where: { id } });
  if (!fila) throw AppError.notFound('Dispensacion');
  return fila;
}

export async function getDispense(id: number): Promise<DispenseItem> {
  return aDispenseItem(await getDispenseOrThrow(id));
}

export async function createDispense(
  input: CreateDispenseInput,
  actorId: string,
  meta: RequestMeta,
): Promise<DispenseItem> {
  const existente = await prisma.medicationDispense.findUnique({ where: { id: input.id } });
  if (existente) throw AppError.conflict(`Ya existe una dispensacion con el id ${input.id}.`);

  const creado = await prisma.$transaction(async (tx) => {
    const fila = await tx.medicationDispense.create({ data: input });
    // Puede mover `lastActivityAt`/`stayHours` del ingreso: recalcula SOLO ese ingreso.
    await recalcularDerivados(tx, { admissionIds: [fila.admissionId] });
    await auditarEnTx(tx, {
      action: AUDIT.registroCreado,
      actorId,
      targetType: 'medication_dispense',
      metadata: { id: fila.id, admissionId: fila.admissionId, code: fila.code, quantity: fila.quantity },
      ...meta,
    });
    return fila;
  });

  return aDispenseItem(creado);
}

export async function updateDispense(
  id: number,
  input: UpdateDispenseInput,
  actorId: string,
  meta: RequestMeta,
): Promise<DispenseItem> {
  const anterior = await getDispenseOrThrow(id);

  const actualizado = await prisma.$transaction(async (tx) => {
    const fila = await tx.medicationDispense.update({ where: { id }, data: input });
    // Si cambio de ingreso, los DOS (el viejo y el nuevo) pueden tener un
    // `lastActivityAt` distinto tras el movimiento; con `Set` se dedup si no cambio.
    await recalcularDerivados(tx, { admissionIds: [...new Set([anterior.admissionId, fila.admissionId])] });
    await auditarEnTx(tx, {
      action: AUDIT.registroActualizado,
      actorId,
      targetType: 'medication_dispense',
      metadata: { id, cambios: Object.keys(input) },
      ...meta,
    });
    return fila;
  });

  return aDispenseItem(actualizado);
}

export async function removeDispense(id: number, actorId: string, meta: RequestMeta): Promise<void> {
  const existente = await getDispenseOrThrow(id);

  await prisma.$transaction(async (tx) => {
    await tx.medicationDispense.delete({ where: { id } });
    await recalcularDerivados(tx, { admissionIds: [existente.admissionId] });
    await auditarEnTx(tx, {
      action: AUDIT.registroBorrado,
      actorId,
      targetType: 'medication_dispense',
      metadata: { id, admissionId: existente.admissionId, code: existente.code },
      ...meta,
    });
  });
}
