import { prisma } from '../../core/db/prisma';
import { redondearDecimales } from '../../core/http/numero';
import { HIS_ZONA_HORARIA } from '../his/his.periodo';

/**
 * Ocupacion y censo estimados (B0, fase B). El HIS no trae fecha de egreso:
 * un ingreso se considera "activo" desde `admittedAt` hasta `lastActivityAt`
 * (maximo de FechaPrestacion entre servicios y medicamentos de ese ingreso).
 * Sin ninguna actividad registrada mas alla del propio ingreso (5 casos en los
 * datos reales), se cuenta activo solo en el instante exacto del ingreso: no
 * hay ningun dato que sugiera una estancia mas larga.
 *
 * Las camas VIRTUALES cuentan en el censo pero NO en la capacidad fisica
 * (capacidad = camas fisicas distintas de la unidad): por eso la ocupacion
 * puede superar el 100% (B0, "urgencias colapsado a mas del 200%").
 *
 * `occupancyPct` se redondea a 2 decimales (`redondearDecimales`, solo en la
 * SALIDA de la API): politica de precision compartida por todas las
 * estadisticas decimales de la API (core/http/numero.ts).
 */

export type MetodoOcupacion = 'censo_estimado_ultima_actividad';
export const METODO_OCUPACION: MetodoOcupacion = 'censo_estimado_ultima_actividad';

export interface OcupacionUnidad {
  unit: string;
  physicalBeds: number;
  census: number;
  occupancyPct: number | 'insufficient_data';
  virtualCensus: number;
}

interface FilaOcupacion {
  unit: string;
  physicalBeds: number;
  census: number;
  virtualCensus: number;
}

/** Censo, capacidad y ocupacion por unidad EN UN INSTANTE concreto. */
export async function ocupacionPorUnidad(instante: Date): Promise<OcupacionUnidad[]> {
  const filas = await prisma.$queryRaw<FilaOcupacion[]>`
    WITH capacidad AS (
      SELECT unit, COUNT(DISTINCT "bedCode")::int AS "physicalBeds"
      FROM his_admissions
      WHERE "virtualBed" = false
      GROUP BY unit
    ),
    censo AS (
      SELECT unit,
        COUNT(*)::int AS census,
        COUNT(*) FILTER (WHERE "virtualBed")::int AS "virtualCensus"
      FROM his_admissions
      WHERE "admittedAt" <= ${instante}::timestamptz
        AND COALESCE("lastActivityAt", "admittedAt") >= ${instante}::timestamptz
      GROUP BY unit
    )
    SELECT COALESCE(cap.unit, c.unit) AS unit,
           COALESCE(cap."physicalBeds", 0)::int AS "physicalBeds",
           COALESCE(c.census, 0)::int AS census,
           COALESCE(c."virtualCensus", 0)::int AS "virtualCensus"
    FROM capacidad cap
    FULL OUTER JOIN censo c ON c.unit = cap.unit
    ORDER BY unit
  `;

  return filas.map((f) => ({
    unit: f.unit,
    physicalBeds: f.physicalBeds,
    census: f.census,
    virtualCensus: f.virtualCensus,
    occupancyPct: f.physicalBeds === 0 ? 'insufficient_data' : redondearDecimales((f.census / f.physicalBeds) * 100),
  }));
}

export interface CensoDiario {
  day: string;
  census: number;
  occupancyPct: number | 'insufficient_data';
}

interface FilaCensoDiario {
  dia: Date;
  census: number;
}

/**
 * Serie diaria del censo TOTAL del hospital (todas las unidades juntas), al
 * cierre (23:59:59 hora de Colombia) de cada dia del periodo. La ocupacion
 * global usa la capacidad fisica total, calculada una sola vez.
 *
 * Implementada como un barrido (sweep line) en vez de un `LEFT JOIN` por dia
 * contra `generate_series`: la version ingenua (una condicion de rango sobre
 * `admittedAt`/`lastActivityAt` evaluada una vez POR DIA) tarda ~400-650ms en
 * datos reales para periodos de 90-366 dias (un `Index Scan` completo por
 * cada dia de la serie), por encima del objetivo de 500ms. Este barrido hace
 * UN solo recorrido ordenado de los eventos de inicio/fin de cada ingreso
 * (una sola vez, no una vez por dia) y acumula el censo con una suma corrida:
 * ~50ms para un año completo, con el mismo resultado exacto (verificado
 * contra la version ingenua en `hospital_local`). `kind` desempata los
 * eventos que caen en el mismo instante que una marca de dia: los inicios
 * (0) cuentan antes que la marca (1), que cuenta antes que los fines (2), asi
 * que `admittedAt <= instante` y `finEstimado >= instante` siguen siendo
 * ambos inclusive, igual que en `ocupacionPorUnidad`.
 *
 * El prefiltro de `admisiones` (la CTE de candidatos) es solo una
 * optimizacion: no puede cambiar el resultado del barrido. El instante mas
 * tardio que de verdad se evalua es el fin del ULTIMO dia de la serie
 * (23:59:59 hora Bogota de ese dia calendario), no `hasta`: cuando `hasta` cae
 * a media tarde (el caso normal, tanto en el periodo por defecto -termina en
 * `fechaReferencia()`, casi nunca medianoche- como en uno explicito), ese fin
 * de dia es POSTERIOR a `hasta`. Acotar el prefiltro con `admittedAt <= hasta`
 * en vez de con ese fin de dia excluia ingresos que empiezan entre `hasta` y
 * la medianoche y que si debian contar en el censo del ultimo dia (subcuenta
 * verificada con SQL directo: 414 en vez de 465).
 */
export async function censoDiario(desde: Date, hasta: Date): Promise<CensoDiario[]> {
  const capacidad = await prisma.$queryRaw<{ physicalBeds: number }[]>`
    SELECT COUNT(DISTINCT "bedCode")::int AS "physicalBeds"
    FROM his_admissions WHERE "virtualBed" = false
  `;
  const physicalBeds = capacidad[0]?.physicalBeds ?? 0;

  const filas = await prisma.$queryRaw<FilaCensoDiario[]>`
    WITH fin_ultimo_dia AS (
      SELECT (
        (date_trunc('day', (${hasta}::timestamptz) AT TIME ZONE ${HIS_ZONA_HORARIA})::date + time '23:59:59')
        AT TIME ZONE ${HIS_ZONA_HORARIA}
      ) AS instante
    ),
    admisiones AS (
      SELECT "admittedAt" AS inicio, COALESCE("lastActivityAt", "admittedAt") AS fin
      FROM his_admissions, fin_ultimo_dia
      WHERE "admittedAt" <= fin_ultimo_dia.instante
        AND COALESCE("lastActivityAt", "admittedAt") >= ${desde}::timestamptz
    ),
    eventos AS (
      SELECT inicio AS t, 1 AS delta, 0 AS kind FROM admisiones
      UNION ALL
      SELECT fin + interval '1 microsecond' AS t, -1 AS delta, 2 AS kind FROM admisiones
    ),
    delta_agrupado AS (
      SELECT t, SUM(delta)::int AS delta, kind FROM eventos GROUP BY t, kind
    ),
    dias AS (
      SELECT generate_series(
        date_trunc('day', (${desde}::timestamptz) AT TIME ZONE ${HIS_ZONA_HORARIA}),
        date_trunc('day', (${hasta}::timestamptz) AT TIME ZONE ${HIS_ZONA_HORARIA}),
        interval '1 day'
      )::date AS dia
    ),
    instantes AS (
      SELECT dia, (dia::date + time '23:59:59') AT TIME ZONE ${HIS_ZONA_HORARIA} AS instante FROM dias
    ),
    combinado AS (
      SELECT t, delta, kind, NULL::date AS dia FROM delta_agrupado
      UNION ALL
      SELECT instante AS t, 0 AS delta, 1 AS kind, dia FROM instantes
    ),
    con_acumulado AS (
      SELECT t, dia, SUM(delta) OVER (ORDER BY t, kind ROWS UNBOUNDED PRECEDING)::int AS census
      FROM combinado
    )
    SELECT dia, census FROM con_acumulado WHERE dia IS NOT NULL ORDER BY dia
  `;

  return filas.map((f) => ({
    day: f.dia.toISOString().slice(0, 10),
    census: f.census,
    occupancyPct: physicalBeds === 0 ? 'insufficient_data' : redondearDecimales((f.census / physicalBeds) * 100),
  }));
}
