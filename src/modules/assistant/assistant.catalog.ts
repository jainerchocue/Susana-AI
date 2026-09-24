import { Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../core/db/prisma';
import { logger } from '../../core/logger';
import { PERMISSIONS } from '../../core/rbac/permissions';
import { alcancesPorPermiso, tienePermiso } from '../../core/rbac/alcance';
import { ALERT_SCOPE_PERMISSION } from '../alerts/alerts.constants';
import { HIS_ZONA_HORARIA } from '../his/his.periodo';
import { sqlOcupacionPorUnidad } from '../analytics/occupancy.service';
import { DIAS_CONSUMO_MEDIO } from '../medications/medications.service';
import type { AgentCatalogEntry } from '../../core/agent/client';

/**
 * Catalogo de datasets que el asistente puede consultar. Cada entrada mapea un
 * nombre LOGICO (el que ve Python) a la tabla/columna REAL (la que ve Node).
 * Python nunca recibe `table`/`column`: solo las claves de `dimensions` y
 * `measures`, via `describirParaAgente`.
 */

export interface Dimension {
  column: string;
  type: 'string' | 'number' | 'date';
  description: string;
  /**
   * Solo para dimensiones `date` cuya columna real es `timestamptz` (las del
   * HIS: se parsean con `-05:00` al importar, B0). El grain diario/semanal/...
   * necesita convertir el instante a esta zona ANTES de truncar
   * (`date_trunc(grain, col AT TIME ZONE zonaHoraria)`): sin ello, el corte de
   * "dia" lo decide el timezone de SESION de Postgres, que no es fiable entre
   * entornos (verificado contra Postgres real: con sesion en UTC, un ingreso a
   * las 23:30 hora Colombia cae en el dia SIGUIENTE si no se convierte).
   * Las columnas `date` que NO son timestamptz (p.ej. `alerts.firstSeenAt`,
   * `timestamp` sin zona) se dejan SIN este campo a proposito: aplicarles
   * `AT TIME ZONE` no las convierte, las REINTERPRETA, y desplazaria la hora
   * 5 horas sin querer.
   */
  zonaHoraria?: string;
  /** Valores posibles FIJOS (enums): viajan tal cual al agente para que filtre con valores reales. */
  values?: readonly string[];
  /**
   * Valores posibles leidos de la BD (`SELECT DISTINCT`, cacheado): el agente
   * filtra con el nombre REAL ("UNIDAD DE CUIDADO INTENSIVO"), no con uno
   * inventado ("UCI"). Prohibido en datasets con `rowFilter` (lo verifica
   * `validarCatalogo`): el DISTINCT no aplica el filtro por fila.
   */
  listable?: boolean;
}

export interface Measure {
  column: string;
  description: string;
}

export interface Dataset {
  key: string;
  table: string;
  description: string;
  permission: string;
  dimensions: Record<string, Dimension>;
  measures: Record<string, Measure>;
  /** Filtrado por fila segun el permiso del usuario (CLAUDE.md §5: no es una puerta). */
  rowFilter?: { column: string; permitidos: (permisos: ReadonlySet<string>) => string[] };
  /**
   * Dataset DERIVADO: subconsulta FIJA (codigo de Node, nunca texto del DSL)
   * que hace de tabla, con `table` como alias. Sus `column` son los alias de
   * esa subconsulta. Sirve para exponer al agente la misma cifra que calcula
   * el panel (ocupacion, dias de inventario) sin darle SQL.
   */
  source?: () => Prisma.Sql;
}

/** Referencia HIS "hoy" = ultimo ingreso importado (misma que `fechaReferencia()`), en SQL. */
const REFERENCIA_SQL = Prisma.sql`(SELECT MAX("admittedAt") FROM his_admissions)`;

export const DATASETS: Readonly<Record<string, Dataset>> = {
  alerts: {
    key: 'alerts',
    table: 'alerts',
    description: 'Alertas operativas generadas por el motor de reglas del hospital.',
    permission: PERMISSIONS.alerts.read,
    dimensions: {
      type: {
        column: 'type',
        type: 'string',
        description: 'Tipo de alerta (LOW_STOCK, HIGH_OCCUPANCY, LONG_WAIT, DEMAND_SPIKE, SURGERY_CANCELLATIONS).',
        values: ['LOW_STOCK', 'HIGH_OCCUPANCY', 'LONG_WAIT', 'DEMAND_SPIKE', 'SURGERY_CANCELLATIONS'],
      },
      severity: { column: 'severity', type: 'string', description: 'Severidad: WARNING o CRITICAL.', values: ['WARNING', 'CRITICAL'] },
      status: {
        column: 'status',
        type: 'string',
        description: 'Estado: OPEN, ACKNOWLEDGED o RESOLVED.',
        values: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'],
      },
      scope: {
        column: 'scope',
        type: 'string',
        description: 'Ambito: medication, service, triage o surgery.',
        values: ['medication', 'service', 'triage', 'surgery'],
      },
      scope_id: { column: 'scopeId', type: 'string', description: 'Codigo HIS del recurso afectado (medicamento, servicio...).' },
      first_seen_at: { column: 'firstSeenAt', type: 'date', description: 'Fecha en la que se detecto por primera vez.' },
      last_seen_at: { column: 'lastSeenAt', type: 'date', description: 'Ultima fecha en la que se detecto activa.' },
    },
    measures: {
      value: { column: 'value', description: 'Valor de la metrica que disparo la alerta.' },
      threshold: { column: 'threshold', description: 'Umbral que se supero.' },
    },
    rowFilter: {
      column: 'scope',
      permitidos: (permisos) => alcancesPorPermiso(permisos, ALERT_SCOPE_PERMISSION),
    },
  },

  // ── Datasets HIS (fase B, T10) ───────────────────────────────────────────
  // Ninguno lleva `rowFilter`: a diferencia de las alertas, el acceso a un
  // dataset HIS no depende del AMBITO del dato (no hay "mi unidad" o "mi
  // medicamento" en RBAC todavia), solo del permiso que lo destapa entero.

  admissions: {
    key: 'admissions',
    table: 'his_admissions',
    description:
      'Ingresos hospitalarios: cada fila es el episodio de un paciente en el hospital, con su unidad, triage y los tiempos derivados de espera y estancia.',
    permission: PERMISSIONS.services.read,
    dimensions: {
      unit: { column: 'unit', type: 'string', description: 'Unidad del ingreso (URGENCIAS, HOSPITALIZACION, PEDIATRIA...).', listable: true },
      subunit: { column: 'subunit', type: 'string', description: 'Subunidad dentro de la unidad.', listable: true },
      admission_class: { column: 'admissionClass', type: 'string', description: 'Clase del ingreso (Ambulatorio, Hospitalario...).', listable: true },
      entry_route: { column: 'entryRoute', type: 'string', description: 'Via de ingreso (Urgencias, Remision...).', listable: true },
      risk_type: { column: 'riskType', type: 'string', description: 'Tipo de riesgo asociado al ingreso.', listable: true },
      diagnosis_code: { column: 'diagnosisCode', type: 'string', description: 'Codigo del diagnostico principal, si existe.' },
      diagnosis_name: { column: 'diagnosisName', type: 'string', description: 'Nombre del diagnostico principal, si existe.' },
      triage_level: { column: 'triageLevel', type: 'number', description: 'Nivel de triage (1 a 5; 1 es el mas urgente). Nulo sin triage.' },
      patient_sex: { column: 'patientSex', type: 'string', description: 'Sexo del paciente en el momento del ingreso.', listable: true },
      patient_regime: { column: 'patientRegime', type: 'string', description: 'Regimen de afiliacion del paciente.', listable: true },
      patient_zone: { column: 'patientZone', type: 'string', description: 'Zona de residencia del paciente: Urbana o Rural.', listable: true },
      admitted_at: {
        column: 'admittedAt',
        type: 'date',
        description: 'Fecha y hora del ingreso.',
        zonaHoraria: HIS_ZONA_HORARIA,
      },
    },
    measures: {
      wait_minutes: { column: 'waitMinutes', description: 'Minutos entre el triage y la primera atencion.' },
      stay_hours: { column: 'stayHours', description: 'Horas entre el ingreso y la ultima actividad registrada (estancia estimada, sin fecha de egreso en el HIS).' },
      patient_age: { column: 'patientAge', description: 'Edad del paciente, en anios, en el momento del ingreso.' },
    },
  },

  services: {
    key: 'services',
    table: 'his_service_records',
    description:
      'Servicios y procedimientos prestados durante un ingreso (laboratorio, imagenes, procedimientos...), con el nombre CUPS del procedimiento.',
    permission: PERMISSIONS.services.read,
    source: () => Prisma.sql`
      SELECT s.*, p.name AS "procedureName"
      FROM his_service_records s
      LEFT JOIN his_procedures p ON p.code = s.code`,
    dimensions: {
      area: { column: 'area', type: 'string', description: 'Area que presto el servicio.', listable: true },
      area_code: { column: 'areaCode', type: 'string', description: 'Codigo del area que presto el servicio.' },
      specialty: { column: 'specialty', type: 'string', description: 'Especialidad medica asociada al servicio.', listable: true },
      code: { column: 'code', type: 'string', description: 'Codigo CUPS del servicio o procedimiento.' },
      procedure_name: { column: 'procedureName', type: 'string', description: 'Nombre del procedimiento (CUPS), si esta en el catalogo HIS.' },
      provided_at: {
        column: 'providedAt',
        type: 'date',
        description: 'Fecha y hora en que se presto el servicio.',
        zonaHoraria: HIS_ZONA_HORARIA,
      },
    },
    measures: {
      quantity: { column: 'quantity', description: 'Cantidad de unidades del servicio prestadas.' },
    },
  },

  medications: {
    key: 'medications',
    table: 'his_medication_dispenses',
    description:
      'Dispensaciones (consumo) de medicamentos e insumos durante un ingreso, con el nombre y el tipo del producto. No es inventario: el stock y los dias de inventario estan en "medication_inventory".',
    permission: PERMISSIONS.medications.read,
    source: () => Prisma.sql`
      SELECT d.*, m.name AS "medicationName", m.kind AS "medicationKind"
      FROM his_medication_dispenses d
      LEFT JOIN his_medications m ON m.code = d.code`,
    dimensions: {
      code: { column: 'code', type: 'string', description: 'Codigo del medicamento o insumo dispensado.' },
      name: { column: 'medicationName', type: 'string', description: 'Nombre del medicamento o insumo.' },
      kind: { column: 'medicationKind', type: 'string', description: 'Tipo: medicamento o insumo.', listable: true },
      area: { column: 'area', type: 'string', description: 'Area donde se hizo la dispensacion.', listable: true },
      specialty: { column: 'specialty', type: 'string', description: 'Especialidad asociada a la dispensacion.', listable: true },
      dispensed_at: {
        column: 'dispensedAt',
        type: 'date',
        description: 'Fecha y hora de la dispensacion.',
        zonaHoraria: HIS_ZONA_HORARIA,
      },
    },
    measures: {
      quantity: { column: 'quantity', description: 'Cantidad dispensada.' },
    },
  },

  // ── Datasets DERIVADOS: la misma cifra que el panel ──────────────────────

  bed_occupancy: {
    key: 'bed_occupancy',
    table: 'bed_occupancy',
    description:
      'Ocupacion de camas por unidad en la fecha de corte de los datos HIS (el "hoy" de los datos): censo estimado de pacientes ingresados, camas fisicas y porcentaje de ocupacion. Misma cifra que el panel. Una fila por unidad.',
    permission: PERMISSIONS.services.read,
    source: () => Prisma.sql`
      SELECT o.unit, o."physicalBeds", o.census, o."virtualCensus",
        CASE WHEN o."physicalBeds" = 0 THEN NULL
             ELSE ROUND(o.census * 100.0 / o."physicalBeds", 2)::float8 END AS "occupancyPct"
      FROM (${sqlOcupacionPorUnidad(REFERENCIA_SQL)}) o`,
    dimensions: {
      unit: { column: 'unit', type: 'string', description: 'Unidad hospitalaria.', listable: true },
    },
    measures: {
      census: { column: 'census', description: 'Camas ocupadas (pacientes ingresados activos) en la fecha de corte.' },
      physical_beds: { column: 'physicalBeds', description: 'Camas fisicas de la unidad (capacidad).' },
      virtual_census: { column: 'virtualCensus', description: 'Pacientes en camas virtuales (cuentan en el censo, no en la capacidad).' },
      occupancy_pct: { column: 'occupancyPct', description: 'Ocupacion = censo / camas fisicas x 100 (puede superar 100). Nulo sin camas fisicas.' },
    },
  },

  medication_inventory: {
    key: 'medication_inventory',
    table: 'medication_inventory',
    description: `Inventario de medicamentos con stock registrado por Farmacia: stock, consumo medio diario (dispensado en los ${DIAS_CONSUMO_MEDIO} dias previos a la fecha de corte / ${DIAS_CONSUMO_MEDIO}) y dias de inventario (stock / consumo medio). Misma cifra que el panel. Una fila por medicamento.`,
    permission: PERMISSIONS.medications.read,
    source: () => Prisma.sql`
      WITH ref AS (SELECT ${REFERENCIA_SQL} AS t),
      consumo AS (
        SELECT d.code, SUM(d.quantity)::float8 / ${DIAS_CONSUMO_MEDIO} AS avg
        FROM his_medication_dispenses d, ref
        WHERE d."dispensedAt" >= ref.t - (${`${DIAS_CONSUMO_MEDIO * 24} hours`})::interval AND d."dispensedAt" <= ref.t
        GROUP BY d.code
      ),
      base AS (
        SELECT s.code, COALESCE(m.name, s.code) AS name, m.kind, s.quantity AS stock,
          COALESCE(c.avg, 0) AS avg,
          CASE WHEN COALESCE(c.avg, 0) > 0 THEN ROUND((s.quantity / c.avg)::numeric, 2)::float8 END AS days
        FROM medication_stock s
        LEFT JOIN his_medications m ON m.code = s.code
        LEFT JOIN consumo c ON c.code = s.code
      )
      SELECT code, name, kind, stock,
        ROUND(avg::numeric, 2)::float8 AS "avgDailyConsumption",
        days AS "daysOfInventory",
        CASE WHEN days IS NULL THEN 'insufficient_data'
             WHEN days < ${env.ALERT_CRITICAL_STOCK_DAYS} THEN 'CRITICAL'
             WHEN days < ${env.ALERT_LOW_STOCK_DAYS} THEN 'LOW'
             ELSE 'OK' END AS risk
      FROM base`,
    dimensions: {
      code: { column: 'code', type: 'string', description: 'Codigo del medicamento o insumo.' },
      name: { column: 'name', type: 'string', description: 'Nombre del medicamento o insumo.' },
      kind: { column: 'kind', type: 'string', description: 'Tipo: medicamento o insumo.', values: ['medicamento', 'insumo'] },
      risk: {
        column: 'risk',
        type: 'string',
        description: `Riesgo: CRITICAL (< ${env.ALERT_CRITICAL_STOCK_DAYS} dias), LOW (< ${env.ALERT_LOW_STOCK_DAYS} dias), OK, o insufficient_data (sin consumo reciente).`,
        values: ['CRITICAL', 'LOW', 'OK', 'insufficient_data'],
      },
    },
    measures: {
      stock: { column: 'stock', description: 'Unidades en stock.' },
      avg_daily_consumption: { column: 'avgDailyConsumption', description: 'Consumo medio diario.' },
      days_of_inventory: { column: 'daysOfInventory', description: 'Dias de inventario = stock / consumo medio diario. Nulo sin consumo.' },
    },
  },

  surgeries: {
    key: 'surgeries',
    table: 'his_surgery_schedules',
    description:
      'Programaciones de cirugia con el nombre del procedimiento. Sin fecha ni medidas numericas en el extracto: solo sirve para contar (count / count_distinct).',
    permission: PERMISSIONS.surgeries.read,
    source: () => Prisma.sql`
      SELECT s.*, p.name AS "procedureName"
      FROM his_surgery_schedules s
      LEFT JOIN his_procedures p ON p.code = s."procedureCode"`,
    dimensions: {
      procedure_code: { column: 'procedureCode', type: 'string', description: 'Codigo del procedimiento quirurgico programado.' },
      procedure_name: { column: 'procedureName', type: 'string', description: 'Nombre del procedimiento quirurgico, si esta en el catalogo HIS.' },
      executed: {
        column: 'executed',
        type: 'string',
        description: '"si", "no" o "desconocido" (desconocido = sin ingreso verificable en el extracto).',
        values: ['si', 'no', 'desconocido'],
      },
      schedule_number: { column: 'scheduleNumber', type: 'string', description: 'Numero de la programacion de cirugia.' },
    },
    measures: {},
  },
};

/** Datasets visibles para un usuario, segun sus permisos efectivos. */
export function datasetsPara(permisos: ReadonlySet<string>): Dataset[] {
  return Object.values(DATASETS).filter((dataset) => tienePermiso(permisos, dataset.permission));
}

/** `FROM` de un dataset: la tabla, o la subconsulta fija de un dataset derivado con `table` como alias. */
export function origenSql(dataset: Dataset): Prisma.Sql {
  const alias = Prisma.raw(`"${dataset.table}"`);
  return dataset.source ? Prisma.sql`(${dataset.source()}) AS ${alias}` : alias;
}

const MAX_VALORES = 80;
const TTL_VALORES_MS = 5 * 60_000;
const cacheValores = new Map<string, { valores: string[] | null; expiraEn: number }>();

/**
 * Valores posibles de una dimension para el agente: los fijos (`values`) o los
 * de la BD (`listable`, DISTINCT cacheado 5 minutos). Mas de `MAX_VALORES`
 * -> ninguno (no es un vocabulario, es un listado). Un fallo de BD no debe
 * tumbar la pregunta: se sigue sin vocabulario (el agente filtra por
 * `contains` en ese caso).
 */
async function valoresDimension(dataset: Dataset, nombre: string, dim: Dimension): Promise<string[] | undefined> {
  if (dim.values) return [...dim.values];
  if (!dim.listable) return undefined;

  const clave = `${dataset.key}.${nombre}`;
  const enCache = cacheValores.get(clave);
  if (enCache && enCache.expiraEn > Date.now()) return enCache.valores ?? undefined;

  try {
    const col = Prisma.raw(`"${dim.column}"`);
    const filas = await prisma.$queryRaw<{ v: string }[]>`
      SELECT DISTINCT ${col}::text AS v FROM ${origenSql(dataset)}
      WHERE ${col} IS NOT NULL ORDER BY 1 LIMIT ${MAX_VALORES + 1}`;
    const valores = filas.length > MAX_VALORES ? null : filas.map((f) => f.v);
    cacheValores.set(clave, { valores, expiraEn: Date.now() + TTL_VALORES_MS });
    return valores ?? undefined;
  } catch (error) {
    logger.warn({ err: error, dimension: clave }, 'No se pudo leer el vocabulario de la dimension');
    return undefined;
  }
}

/** Version del catalogo que se manda a Python: solo nombres logicos (y valores reales), nunca table/column. */
export async function describirParaAgente(datasets: Dataset[]): Promise<AgentCatalogEntry[]> {
  return Promise.all(
    datasets.map(async (dataset) => ({
      dataset: dataset.key,
      description: dataset.description,
      dimensions: await Promise.all(
        Object.entries(dataset.dimensions).map(async ([name, dim]) => {
          const values = await valoresDimension(dataset, name, dim);
          return { name, type: dim.type, description: dim.description, ...(values ? { values } : {}) };
        }),
      ),
      measures: Object.entries(dataset.measures).map(([name, medida]) => ({ name, description: medida.description })),
    })),
  );
}

// ── Verificacion al cargar el modulo ────────────────────────────────────────
// Un dataset mal declarado no es un error de usuario: es un bug de despliegue.
// Mejor que el proceso no arranque a que sirva un catalogo con una columna que
// no existe o, peor, con un caracter que rompa el identificador SQL.

const CLAVE_LOGICA = /^[a-z][a-z0-9_]{0,62}$/;
const IDENTIFICADOR_SQL = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validarIdentificador(valor: string, contexto: string): void {
  if (!IDENTIFICADOR_SQL.test(valor)) {
    throw new Error(`Catalogo del asistente invalido: identificador SQL "${valor}" (${contexto}).`);
  }
}

function validarCatalogo(datasets: Readonly<Record<string, Dataset>>): void {
  for (const [clave, dataset] of Object.entries(datasets)) {
    if (!CLAVE_LOGICA.test(clave) || clave !== dataset.key) {
      throw new Error(`Catalogo del asistente invalido: clave de dataset "${clave}".`);
    }
    validarIdentificador(dataset.table, `tabla de "${clave}"`);

    for (const [nombre, dim] of Object.entries(dataset.dimensions)) {
      if (!CLAVE_LOGICA.test(nombre)) throw new Error(`Catalogo del asistente invalido: dimension "${nombre}".`);
      validarIdentificador(dim.column, `columna de la dimension "${nombre}"`);
      if (dim.listable && dataset.rowFilter) {
        throw new Error(`Catalogo del asistente invalido: "${nombre}" es listable en un dataset con rowFilter.`);
      }
    }
    for (const [nombre, medida] of Object.entries(dataset.measures)) {
      if (!CLAVE_LOGICA.test(nombre)) throw new Error(`Catalogo del asistente invalido: medida "${nombre}".`);
      validarIdentificador(medida.column, `columna de la medida "${nombre}"`);
    }
    if (dataset.rowFilter) validarIdentificador(dataset.rowFilter.column, `rowFilter de "${clave}"`);
  }
}

validarCatalogo(DATASETS);
