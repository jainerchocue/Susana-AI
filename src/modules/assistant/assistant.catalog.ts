import { PERMISSIONS } from '../../core/rbac/permissions';
import { alcancesPorPermiso, tienePermiso } from '../../core/rbac/alcance';
import { ALERT_SCOPE_PERMISSION } from '../alerts/alerts.constants';
import { HIS_ZONA_HORARIA } from '../his/his.periodo';
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
}

export const DATASETS: Readonly<Record<string, Dataset>> = {
  alerts: {
    key: 'alerts',
    table: 'alerts',
    description: 'Alertas operativas generadas por el motor de reglas del hospital.',
    permission: PERMISSIONS.alerts.read,
    dimensions: {
      type: { column: 'type', type: 'string', description: 'Tipo de alerta (LOW_STOCK, HIGH_OCCUPANCY, LONG_WAIT, DEMAND_SPIKE, SURGERY_CANCELLATIONS).' },
      severity: { column: 'severity', type: 'string', description: 'Severidad: WARNING o CRITICAL.' },
      status: { column: 'status', type: 'string', description: 'Estado: OPEN, ACKNOWLEDGED o RESOLVED.' },
      scope: { column: 'scope', type: 'string', description: 'Ambito: medication, service, triage o surgery.' },
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
      unit: { column: 'unit', type: 'string', description: 'Unidad del ingreso (URGENCIAS, HOSPITALIZACION, PEDIATRIA...).' },
      subunit: { column: 'subunit', type: 'string', description: 'Subunidad dentro de la unidad.' },
      admission_class: { column: 'admissionClass', type: 'string', description: 'Clase del ingreso (Ambulatorio, Hospitalario...).' },
      entry_route: { column: 'entryRoute', type: 'string', description: 'Via de ingreso (Urgencias, Remision...).' },
      risk_type: { column: 'riskType', type: 'string', description: 'Tipo de riesgo asociado al ingreso.' },
      diagnosis_code: { column: 'diagnosisCode', type: 'string', description: 'Codigo del diagnostico principal, si existe.' },
      diagnosis_name: { column: 'diagnosisName', type: 'string', description: 'Nombre del diagnostico principal, si existe.' },
      triage_level: { column: 'triageLevel', type: 'number', description: 'Nivel de triage (1 a 5; 1 es el mas urgente). Nulo sin triage.' },
      patient_sex: { column: 'patientSex', type: 'string', description: 'Sexo del paciente en el momento del ingreso.' },
      patient_regime: { column: 'patientRegime', type: 'string', description: 'Regimen de afiliacion del paciente.' },
      patient_zone: { column: 'patientZone', type: 'string', description: 'Zona de residencia del paciente: Urbana o Rural.' },
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
    description: 'Servicios y procedimientos prestados durante un ingreso (laboratorio, imagenes, procedimientos...).',
    permission: PERMISSIONS.services.read,
    dimensions: {
      area: { column: 'area', type: 'string', description: 'Area que presto el servicio.' },
      area_code: { column: 'areaCode', type: 'string', description: 'Codigo del area que presto el servicio.' },
      specialty: { column: 'specialty', type: 'string', description: 'Especialidad medica asociada al servicio.' },
      code: { column: 'code', type: 'string', description: 'Codigo CUPS del servicio o procedimiento.' },
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
      'Dispensaciones de medicamentos e insumos durante un ingreso. Limite: no hay JOIN en este dataset, asi que no trae el nombre ni el tipo del medicamento, solo su codigo.',
    permission: PERMISSIONS.medications.read,
    dimensions: {
      code: { column: 'code', type: 'string', description: 'Codigo del medicamento o insumo dispensado.' },
      area: { column: 'area', type: 'string', description: 'Area donde se hizo la dispensacion.' },
      specialty: { column: 'specialty', type: 'string', description: 'Especialidad asociada a la dispensacion.' },
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

  surgeries: {
    key: 'surgeries',
    table: 'his_surgery_schedules',
    description:
      'Programaciones de cirugia. Sin fecha ni medidas numericas en el extracto: solo sirve para contar (count / count_distinct).',
    permission: PERMISSIONS.surgeries.read,
    dimensions: {
      procedure_code: { column: 'procedureCode', type: 'string', description: 'Codigo del procedimiento quirurgico programado.' },
      executed: {
        column: 'executed',
        type: 'string',
        description: '"si", "no" o "desconocido" (desconocido = sin ingreso verificable en el extracto).',
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

/** Version del catalogo que se manda a Python: solo nombres logicos, nunca table/column. */
export function describirParaAgente(datasets: Dataset[]): AgentCatalogEntry[] {
  return datasets.map((dataset) => ({
    dataset: dataset.key,
    description: dataset.description,
    dimensions: Object.entries(dataset.dimensions).map(([name, dim]) => ({
      name,
      type: dim.type,
      description: dim.description,
    })),
    measures: Object.entries(dataset.measures).map(([name, medida]) => ({ name, description: medida.description })),
  }));
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
    }
    for (const [nombre, medida] of Object.entries(dataset.measures)) {
      if (!CLAVE_LOGICA.test(nombre)) throw new Error(`Catalogo del asistente invalido: medida "${nombre}".`);
      validarIdentificador(medida.column, `columna de la medida "${nombre}"`);
    }
    if (dataset.rowFilter) validarIdentificador(dataset.rowFilter.column, `rowFilter de "${clave}"`);
  }
}

validarCatalogo(DATASETS);
