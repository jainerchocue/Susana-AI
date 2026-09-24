import { prisma } from '../../core/db/prisma';
import { AUDIT, auditar, type RequestMeta } from '../../core/audit/audit';
import { redondearDecimales } from '../../core/http/numero';

/**
 * Analitica de cirugias programadas (T9). B0: `SurgerySchedule` no tiene FK
 * (ni a Paciente ni a Ingreso: el diccionario las declara pero los datos
 * reales no las cumplen), asi que la unidad del ingreso vinculado se resuelve
 * con una segunda consulta y se cruza en memoria, nunca con un `include` de
 * Prisma (no hay relacion declarada en el schema para expresarlo).
 *
 * Los porcentajes (`pct`, `executedPct`, `notExecutedPct`, `pctSinEjecucion`)
 * se redondean a 2 decimales (`redondearDecimales`, core/http/numero.ts):
 * misma politica de precision que el resto de estadisticas decimales de la
 * API, aunque aqui el calculo es entero/JS (sin AVG de Postgres de por medio).
 */

const TOP_PROCEDIMIENTOS = 10;

interface ConteoEjecucion {
  executed: number;
  notExecuted: number;
  unknown: number;
  total: number;
}

/** `executed` ∈ {'si','no','desconocido'} (B0): 'desconocido' = sin ingreso verificable en el extracto. */
async function contarPorEjecucion(): Promise<ConteoEjecucion> {
  const grupos = await prisma.surgerySchedule.groupBy({ by: ['executed'], _count: { executed: true } });
  const mapa = new Map(grupos.map((g) => [g.executed, g._count.executed]));
  const executed = mapa.get('si') ?? 0;
  const notExecuted = mapa.get('no') ?? 0;
  const unknown = mapa.get('desconocido') ?? 0;
  return { executed, notExecuted, unknown, total: executed + notExecuted + unknown };
}

async function agruparPorUnidad(): Promise<Array<{ unit: string; count: number }>> {
  const filas = await prisma.surgerySchedule.findMany({
    where: { executed: { not: 'desconocido' }, admissionId: { not: null } },
    select: { admissionId: true },
  });
  const admissionIds = [...new Set(filas.map((f) => f.admissionId).filter((id): id is number => id !== null))];
  if (admissionIds.length === 0) return [];

  const admisiones = await prisma.admission.findMany({
    where: { id: { in: admissionIds } },
    select: { id: true, unit: true },
  });
  const unidadPorIngreso = new Map(admisiones.map((a) => [a.id, a.unit]));

  const conteos = new Map<string, number>();
  for (const fila of filas) {
    const unidad = fila.admissionId !== null ? unidadPorIngreso.get(fila.admissionId) : undefined;
    if (!unidad) continue;
    conteos.set(unidad, (conteos.get(unidad) ?? 0) + 1);
  }
  return [...conteos.entries()]
    .map(([unit, count]) => ({ unit, count }))
    .sort((a, b) => b.count - a.count || a.unit.localeCompare(b.unit));
}

export interface SurgeriesSummary {
  totalSchedules: number;
  distinctProcedures: number;
  /** Programaciones cuyo ingreso SI esta en el extracto (= verificables). */
  withAdmissionInExtract: { count: number; pct: number | 'insufficient_data' };
  verifiable: {
    total: number;
    executed: number;
    executedPct: number | 'insufficient_data';
    notExecuted: number;
    notExecutedPct: number | 'insufficient_data';
  };
  unknown: number;
  topProcedures: Array<{ code: string; name: string | null; count: number }>;
  byUnit: Array<{ unit: string; count: number }>;
}

export async function resumen(): Promise<SurgeriesSummary> {
  const [conteo, gruposProcedimiento, byUnit] = await Promise.all([
    contarPorEjecucion(),
    prisma.surgerySchedule.groupBy({ by: ['procedureCode'], _count: { procedureCode: true } }),
    agruparPorUnidad(),
  ]);

  const top10 = [...gruposProcedimiento]
    .sort((a, b) => b._count.procedureCode - a._count.procedureCode || a.procedureCode.localeCompare(b.procedureCode))
    .slice(0, TOP_PROCEDIMIENTOS);
  const nombres = await prisma.procedure.findMany({ where: { code: { in: top10.map((g) => g.procedureCode) } } });
  const nombrePorCodigo = new Map(nombres.map((p) => [p.code, p.name]));
  const topProcedures = top10.map((g) => ({
    code: g.procedureCode,
    name: nombrePorCodigo.get(g.procedureCode) ?? null,
    count: g._count.procedureCode,
  }));

  const verificable = conteo.executed + conteo.notExecuted;
  const totalSchedules = conteo.total;

  return {
    totalSchedules,
    distinctProcedures: gruposProcedimiento.length,
    withAdmissionInExtract: {
      count: verificable,
      pct: totalSchedules > 0 ? redondearDecimales((verificable / totalSchedules) * 100) : 'insufficient_data',
    },
    verifiable: {
      total: verificable,
      executed: conteo.executed,
      executedPct: verificable > 0 ? redondearDecimales((conteo.executed / verificable) * 100) : 'insufficient_data',
      notExecuted: conteo.notExecuted,
      notExecutedPct: verificable > 0 ? redondearDecimales((conteo.notExecuted / verificable) * 100) : 'insufficient_data',
    },
    unknown: conteo.unknown,
    topProcedures,
    byUnit,
  };
}

/** Para T11 (motor de alertas): % de cirugias verificables sin ejecucion registrada. */
export async function pctSinEjecucion(): Promise<number | 'insufficient_data'> {
  const conteo = await contarPorEjecucion();
  const verificable = conteo.executed + conteo.notExecuted;
  if (verificable === 0) return 'insufficient_data';
  return redondearDecimales((conteo.notExecuted / verificable) * 100);
}

export interface SurgeryExportRow {
  scheduleNumber: string;
  patientId: number;
  admissionId: number | null;
  procedureCode: string;
  procedureName: string | null;
  unit: string | null;
  executed: string;
}

export async function exportar(actorId: string, meta: RequestMeta): Promise<SurgeryExportRow[]> {
  const filas = await prisma.surgerySchedule.findMany({ orderBy: [{ scheduleNumber: 'asc' }, { id: 'asc' }] });
  const codigos = [...new Set(filas.map((f) => f.procedureCode))];
  const admissionIds = [...new Set(filas.map((f) => f.admissionId).filter((id): id is number => id !== null))];

  const [procedimientos, admisiones] = await Promise.all([
    prisma.procedure.findMany({ where: { code: { in: codigos } } }),
    prisma.admission.findMany({ where: { id: { in: admissionIds } }, select: { id: true, unit: true } }),
  ]);
  const nombrePorCodigo = new Map(procedimientos.map((p) => [p.code, p.name]));
  const unidadPorIngreso = new Map(admisiones.map((a) => [a.id, a.unit]));

  const resultado: SurgeryExportRow[] = filas.map((f) => ({
    scheduleNumber: f.scheduleNumber,
    patientId: f.patientId,
    admissionId: f.admissionId,
    procedureCode: f.procedureCode,
    procedureName: nombrePorCodigo.get(f.procedureCode) ?? null,
    unit: f.admissionId !== null ? (unidadPorIngreso.get(f.admissionId) ?? null) : null,
    executed: f.executed,
  }));

  await auditar({
    action: AUDIT.exportacion,
    actorId,
    metadata: { report: 'surgeries', filas: resultado.length },
    ...meta,
  });

  return resultado;
}
