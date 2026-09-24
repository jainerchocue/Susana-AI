import { prisma } from '../../core/db/prisma';
import { redondearDecimales } from '../../core/http/numero';
import { HIS_ZONA_HORARIA } from '../his/his.periodo';

const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

export interface DemandaUnidad {
  unit: string;
  last7: number;
  prev7: number;
  changePct: number | 'insufficient_data';
}

interface FilaDemanda {
  unit: string;
  last7: number;
  prev7: number;
}

/**
 * Cambio de demanda por unidad: ingresos de los ultimos 7 dias frente a los 7
 * dias inmediatamente anteriores, ambas ventanas terminando en `hasta`
 * (normalmente `fechaReferencia()`). `prev7 = 0` -> `changePct` no se puede
 * calcular (division por cero no es "0% de cambio", es dato insuficiente).
 * `changePct` se redondea a 2 decimales (`redondearDecimales`, solo en la
 * salida de la API): misma politica de precision que el resto de porcentajes
 * (core/http/numero.ts).
 */
export async function cambioDemandaPorUnidad(hasta: Date): Promise<DemandaUnidad[]> {
  const finUltimos7 = hasta;
  const inicioUltimos7 = new Date(hasta.getTime() - SIETE_DIAS_MS);
  const inicioPrevios7 = new Date(inicioUltimos7.getTime() - SIETE_DIAS_MS);

  const filas = await prisma.$queryRaw<FilaDemanda[]>`
    SELECT unit,
      COUNT(*) FILTER (
        WHERE "admittedAt" > ${inicioUltimos7}::timestamptz AND "admittedAt" <= ${finUltimos7}::timestamptz
      )::int AS last7,
      COUNT(*) FILTER (
        WHERE "admittedAt" > ${inicioPrevios7}::timestamptz AND "admittedAt" <= ${inicioUltimos7}::timestamptz
      )::int AS prev7
    FROM his_admissions
    WHERE "admittedAt" > ${inicioPrevios7}::timestamptz AND "admittedAt" <= ${finUltimos7}::timestamptz
    GROUP BY unit
    ORDER BY unit
  `;

  return filas.map((f) => ({
    unit: f.unit,
    last7: f.last7,
    prev7: f.prev7,
    changePct: f.prev7 === 0 ? 'insufficient_data' : redondearDecimales(((f.last7 - f.prev7) / f.prev7) * 100),
  }));
}

/** Conteo simple de ingresos en un rango, para los contadores del resumen del panel. */
export async function conteoIngresos(desde: Date, hasta: Date): Promise<number> {
  return prisma.admission.count({ where: { admittedAt: { gte: desde, lte: hasta } } });
}

export interface IngresoPorDiaUnidad {
  day: string;
  unit: string;
  n: number;
}

interface FilaIngresoPorDiaUnidad {
  dia: Date;
  unit: string;
  n: number;
}

export async function ingresosPorDiaYUnidad(desde: Date, hasta: Date): Promise<IngresoPorDiaUnidad[]> {
  const filas = await prisma.$queryRaw<FilaIngresoPorDiaUnidad[]>`
    SELECT date_trunc('day', "admittedAt" AT TIME ZONE ${HIS_ZONA_HORARIA})::date AS dia, unit, COUNT(*)::int AS n
    FROM his_admissions
    WHERE "admittedAt" >= ${desde}::timestamptz AND "admittedAt" <= ${hasta}::timestamptz
    GROUP BY dia, unit
    ORDER BY dia, unit
  `;
  return filas.map((f) => ({ day: f.dia.toISOString().slice(0, 10), unit: f.unit, n: f.n }));
}

export interface IngresoPorVia {
  entryRoute: string;
  n: number;
}

export async function ingresosPorViaIngreso(desde: Date, hasta: Date): Promise<IngresoPorVia[]> {
  return prisma.$queryRaw<IngresoPorVia[]>`
    SELECT "entryRoute" AS "entryRoute", COUNT(*)::int AS n
    FROM his_admissions
    WHERE "admittedAt" >= ${desde}::timestamptz AND "admittedAt" <= ${hasta}::timestamptz
    GROUP BY "entryRoute"
    ORDER BY n DESC
  `;
}

export interface PerfilHora {
  hour: number;
  n: number;
}

export async function perfilHorarioIngresos(desde: Date, hasta: Date): Promise<PerfilHora[]> {
  return prisma.$queryRaw<PerfilHora[]>`
    SELECT EXTRACT(HOUR FROM "admittedAt" AT TIME ZONE ${HIS_ZONA_HORARIA})::int AS hour, COUNT(*)::int AS n
    FROM his_admissions
    WHERE "admittedAt" >= ${desde}::timestamptz AND "admittedAt" <= ${hasta}::timestamptz
    GROUP BY hour
    ORDER BY hour
  `;
}
