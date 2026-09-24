import { prisma } from '../../core/db/prisma';
import { HIS_ZONA_HORARIA } from '../his/his.periodo';

/**
 * Consultas de analitica que no encajan tematicamente en ocupacion/espera/
 * demanda (esas tres viven en occupancy.service/wait-time.service/
 * demand.service porque T9/T11 las reusan tal cual): volumen de servicios,
 * catalogo de procedimientos y distribucion de triage.
 *
 * Archivo NO listado explicitamente en el plan de T8 (que solo enumera
 * occupancy/wait-time/demand.service.ts); se añade para cumplir CLAUDE.md §6
 * ("todo Prisma vive en *.service.ts, un controlador nunca importa prisma") y
 * §1 (estructura de modulo con su propio service). Documentado como
 * desviacion en el reporte final de la tarea.
 */

export interface VolumenAreaEspecialidad {
  area: string;
  specialty: string;
  lines: number;
  quantity: number;
}

export async function volumenPorAreaEspecialidad(desde: Date, hasta: Date): Promise<VolumenAreaEspecialidad[]> {
  return prisma.$queryRaw<VolumenAreaEspecialidad[]>`
    SELECT area, specialty, COUNT(*)::int AS lines, SUM(quantity)::int AS quantity
    FROM his_service_records
    WHERE "providedAt" >= ${desde}::timestamptz AND "providedAt" <= ${hasta}::timestamptz
    GROUP BY area, specialty
    -- Desempate por area/specialty: un ORDER BY solo por quantity no es
    -- determinista entre ejecuciones cuando hay empates (verificado en
    -- E2E: /analytics/services y /analytics/services/export, dos llamadas
    -- HTTP separadas sobre el mismo periodo, devolvian filas en distinto
    -- orden). Sin desempate, tampoco se puede prometer un CSV reproducible.
    ORDER BY quantity DESC, area, specialty
  `;
}

export interface TopProcedimiento {
  code: string;
  name: string | null;
  quantity: number;
}

/** Top procedimientos por cantidad. El nombre sale del catalogo derivado (his_procedures); puede ser null si el codigo no llego a entrar en el catalogo. */
export async function topProcedimientos(desde: Date, hasta: Date, limite = 10): Promise<TopProcedimiento[]> {
  return prisma.$queryRaw<TopProcedimiento[]>`
    SELECT sr.code AS code, p.name AS name, SUM(sr.quantity)::int AS quantity
    FROM his_service_records sr
    LEFT JOIN his_procedures p ON p.code = sr.code
    WHERE sr."providedAt" >= ${desde}::timestamptz AND sr."providedAt" <= ${hasta}::timestamptz
    GROUP BY sr.code, p.name
    -- Desempate deterministico (ver el comentario de volumenPorAreaEspecialidad):
    -- con LIMIT, un empate sin desempatar tambien puede cambiar QUE filas entran.
    ORDER BY quantity DESC, sr.code
    LIMIT ${limite}
  `;
}

export interface SerieDiariaServicios {
  day: string;
  lines: number;
  quantity: number;
}

interface FilaSerieDiariaServicios {
  dia: Date;
  lines: number;
  quantity: number;
}

/** Serie diaria de volumen de servicios. Solo lista dias con al menos una linea (sin rellenar huecos). */
export async function serieDiariaServicios(desde: Date, hasta: Date): Promise<SerieDiariaServicios[]> {
  const filas = await prisma.$queryRaw<FilaSerieDiariaServicios[]>`
    SELECT date_trunc('day', "providedAt" AT TIME ZONE ${HIS_ZONA_HORARIA})::date AS dia,
      COUNT(*)::int AS lines, SUM(quantity)::int AS quantity
    FROM his_service_records
    WHERE "providedAt" >= ${desde}::timestamptz AND "providedAt" <= ${hasta}::timestamptz
    GROUP BY dia
    ORDER BY dia
  `;
  return filas.map((f) => ({ day: f.dia.toISOString().slice(0, 10), lines: f.lines, quantity: f.quantity }));
}

export interface DistribucionNivel {
  level: number | null;
  n: number;
}

/** Distribucion de triages por nivel (1-5, null = nivel no detectado en el texto). */
export async function distribucionTriagePorNivel(desde: Date, hasta: Date): Promise<DistribucionNivel[]> {
  return prisma.$queryRaw<DistribucionNivel[]>`
    SELECT level, COUNT(*)::int AS n
    FROM his_triages
    WHERE "triagedAt" >= ${desde}::timestamptz AND "triagedAt" <= ${hasta}::timestamptz
    GROUP BY level
    ORDER BY level
  `;
}

export interface DistribucionClasificacion {
  classification: string;
  n: number;
}

/** Top clasificaciones de triage (texto libre): acotado a `limite` para no devolver cientos de variantes. */
export async function distribucionTriagePorClasificacion(
  desde: Date,
  hasta: Date,
  limite = 15,
): Promise<DistribucionClasificacion[]> {
  return prisma.$queryRaw<DistribucionClasificacion[]>`
    SELECT classification, COUNT(*)::int AS n
    FROM his_triages
    WHERE "triagedAt" >= ${desde}::timestamptz AND "triagedAt" <= ${hasta}::timestamptz
    GROUP BY classification
    -- Desempate deterministico (ver el comentario de volumenPorAreaEspecialidad).
    ORDER BY n DESC, classification
    LIMIT ${limite}
  `;
}

export interface PerfilHoraTriage {
  hour: number;
  n: number;
}

export async function perfilHorarioTriage(desde: Date, hasta: Date): Promise<PerfilHoraTriage[]> {
  return prisma.$queryRaw<PerfilHoraTriage[]>`
    SELECT EXTRACT(HOUR FROM "triagedAt" AT TIME ZONE ${HIS_ZONA_HORARIA})::int AS hour, COUNT(*)::int AS n
    FROM his_triages
    WHERE "triagedAt" >= ${desde}::timestamptz AND "triagedAt" <= ${hasta}::timestamptz
    GROUP BY hour
    ORDER BY hour
  `;
}
