import { prisma } from '../../core/db/prisma';
import { HIS_ZONA_HORARIA } from '../his/his.periodo';

/**
 * Espera entre triage y primera atencion (`Admission.waitMinutes`, ya
 * derivado por el importador de T6). Solo entran en el calculo los ingresos
 * con triage Y atencion registrada: el resto tiene `waitMinutes` null (B0).
 *
 * `p50`/`p90`/`avg` se redondean a 2 decimales EN SQL (`round(x::numeric,2)`):
 * Postgres puede paralelizar `AVG`/`percentile_cont` sobre `float8`, y el
 * orden de combinacion de los workers no esta garantizado, asi que el mismo
 * SELECT puede devolver un digito distinto en la cola del decimal entre
 * ejecuciones (verificado: JSON y CSV de /analytics/triage, misma peticion,
 * `avg` distinto en el decimal 14). El redondeo es solo de SALIDA: no toca
 * `Admission.waitMinutes` en la BD.
 */

export interface EsperaNivel {
  level: number;
  n: number;
  p50: number;
  p90: number;
  avg: number;
}

/** Espera por nivel de triage: n, p50, p90 y media en minutos. Reusado por analytics/triage. */
export async function esperaPorNivel(desde: Date, hasta: Date): Promise<EsperaNivel[]> {
  return prisma.$queryRaw<EsperaNivel[]>`
    SELECT "triageLevel" AS level,
      COUNT(*)::int AS n,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY "waitMinutes")::numeric, 2)::float8 AS p50,
      round(percentile_cont(0.9) WITHIN GROUP (ORDER BY "waitMinutes")::numeric, 2)::float8 AS p90,
      round(AVG("waitMinutes")::numeric, 2)::float8 AS avg
    FROM his_admissions
    WHERE "waitMinutes" IS NOT NULL
      AND "triageLevel" IS NOT NULL
      AND "admittedAt" >= ${desde}::timestamptz AND "admittedAt" <= ${hasta}::timestamptz
    GROUP BY "triageLevel"
    ORDER BY "triageLevel"
  `;
}

export interface EsperaGlobal {
  n: number;
  p50: number | 'insufficient_data';
}

interface FilaEsperaGlobal {
  n: number;
  p50: number | null;
}

/** Espera global (todos los niveles juntos), para el resumen del panel. */
export async function esperaGlobal(desde: Date, hasta: Date): Promise<EsperaGlobal> {
  const filas = await prisma.$queryRaw<FilaEsperaGlobal[]>`
    SELECT COUNT(*)::int AS n,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY "waitMinutes")::numeric, 2)::float8 AS p50
    FROM his_admissions
    WHERE "waitMinutes" IS NOT NULL
      AND "admittedAt" >= ${desde}::timestamptz AND "admittedAt" <= ${hasta}::timestamptz
  `;
  const fila = filas[0];
  const n = fila?.n ?? 0;
  return { n, p50: n === 0 ? 'insufficient_data' : (fila?.p50 ?? 'insufficient_data') };
}

export interface P50Diario {
  day: string;
  n: number;
  p50: number | 'insufficient_data';
}

interface FilaP50Diario {
  dia: Date;
  n: number;
  p50: number | null;
}

/** Serie diaria de la mediana de espera (todos los niveles), en hora de Colombia. */
export async function p50Diario(desde: Date, hasta: Date): Promise<P50Diario[]> {
  const filas = await prisma.$queryRaw<FilaP50Diario[]>`
    SELECT gs.dia::date AS dia,
      COUNT(a.id)::int AS n,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY a."waitMinutes")::numeric, 2)::float8 AS p50
    FROM generate_series(
      date_trunc('day', (${desde}::timestamptz) AT TIME ZONE ${HIS_ZONA_HORARIA}),
      date_trunc('day', (${hasta}::timestamptz) AT TIME ZONE ${HIS_ZONA_HORARIA}),
      interval '1 day'
    ) AS gs(dia)
    LEFT JOIN his_admissions a
      ON date_trunc('day', a."admittedAt" AT TIME ZONE ${HIS_ZONA_HORARIA}) = gs.dia
     AND a."waitMinutes" IS NOT NULL
     AND a."admittedAt" >= ${desde}::timestamptz AND a."admittedAt" <= ${hasta}::timestamptz
    GROUP BY gs.dia
    ORDER BY gs.dia
  `;

  return filas.map((f) => ({
    day: f.dia.toISOString().slice(0, 10),
    n: f.n,
    p50: f.n === 0 ? 'insufficient_data' : (f.p50 ?? 'insufficient_data'),
  }));
}
