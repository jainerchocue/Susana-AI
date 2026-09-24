import { z, type ZodTypeAny } from 'zod';
import {
  createUserSchema,
  listUsersQuerySchema,
  publicUserResponseSchema,
  setUserRolesSchema,
  updateMeSchema,
  updateUserSchema,
} from '../../modules/users/users.schemas';
import {
  createRoleSchema,
  listRolesQuerySchema,
  publicRoleResponseSchema,
  setRolePermissionsSchema,
  updateRoleSchema,
} from '../../modules/roles/roles.schemas';
import { auditEntryResponseSchema, listAuditQuerySchema } from '../../modules/audit/audit.schemas';
import {
  alertRuleResponseSchema,
  createManualAlertSchema,
  evaluateAlertsResponseSchema,
  listAlertsQuerySchema,
  publicAlertResponseSchema,
  ruleTypeParamSchema,
  updateAlertSchema,
  updateRuleSchema,
} from '../../modules/alerts/alerts.schemas';
import { askSchema, assistantResponseSchema } from '../../modules/assistant/assistant.schemas';
import {
  dashboardDemandResponseSchema,
  dashboardOccupancyResponseSchema,
  dashboardQuerySchema,
  dashboardSummaryResponseSchema,
  dashboardWaitTimesResponseSchema,
} from '../../modules/dashboard/dashboard.schemas';
import {
  createPatientSchema,
  listPatientsQuerySchema,
  publicPatientResponseSchema,
  updatePatientSchema,
} from '../../modules/patients/patients.schemas';
import {
  createAdmissionSchema,
  listAdmissionsQuerySchema,
  publicAdmissionResponseSchema,
  setFirstCareSchema,
  updateAdmissionSchema,
} from '../../modules/admissions/admissions.schemas';
import {
  createTriageSchema,
  listTriagesQuerySchema,
  publicTriageResponseSchema,
  updateTriageSchema,
} from '../../modules/triages/triages.schemas';
import {
  analyticsQuerySchema,
  analyticsServicesResponseSchema,
  analyticsTriageResponseSchema,
} from '../../modules/analytics/analytics.schemas';
import {
  codeParamSchema,
  consumptionQuerySchema,
  consumptionResponseSchema,
  createDispenseSchema,
  createMedicationSchema,
  criticalMedicationsResponseSchema,
  dispenseResponseSchema,
  listDispensesQuerySchema,
  listMedicationsQuerySchema,
  listStockQuerySchema,
  medicationCatalogResponseSchema,
  medicationDetailResponseSchema,
  medicationListItemResponseSchema,
  stockListItemResponseSchema,
  stockResponseSchema,
  updateDispenseSchema,
  updateMedicationSchema,
  updateStockSchema,
} from '../../modules/medications/medications.schemas';
import { emptyQuerySchema, surgeriesSummaryResponseSchema } from '../../modules/surgeries/surgeries.schemas';
import { permissionsListResponseSchema } from '../../modules/permissions/permissions.schemas';
import {
  livenessResponseSchema,
  readinessResponseSchema,
  startupResponseSchema,
} from '../../modules/health/health.schemas';
import { idParamSchema } from '../http/schemas';
import { hisIdParamSchema } from '../../modules/his/his.schemas';
import {
  fileNameQuerySchema,
  importJobResponseSchema,
  listImportsQuerySchema,
  tablaParamSchema,
} from '../../modules/imports/imports.schemas';
import {
  createProcedureSchema,
  listProceduresQuerySchema,
  procedureCodeParamSchema,
  procedureResponseSchema,
  updateProcedureSchema,
} from '../../modules/procedures/procedures.schemas';
import {
  createServiceRecordSchema,
  listServiceRecordsQuerySchema,
  serviceRecordResponseSchema,
  updateServiceRecordSchema,
} from '../../modules/service-records/service-records.schemas';
import {
  createSurgeryScheduleSchema,
  listSurgerySchedulesQuerySchema,
  surgeryScheduleResponseSchema,
  updateSurgeryScheduleSchema,
} from '../../modules/surgery-schedules/surgery-schedules.schemas';

/** Forma exacta de `GET {API_PREFIX}` (app.ts): el indice de la API. */
export const indexResponseSchema = z.object({
  name: z.string(),
  environment: z.string(),
  endpoints: z.array(z.string()),
});

/**
 * Registro de rutas para el contrato OpenAPI.
 *
 * Se referencian los MISMOS objetos Zod que usa `validate()`: si un schema
 * cambia, el contrato cambia con el. No hay forma de que se desincronicen.
 *
 * Las rutas bajo /auth NO estan aqui: las sirve Better Auth y `openapi.ts`
 * (`construirOpenApi`) las fusiona en el MISMO `openapi.json` con una llamada
 * de servidor a `auth.api.generateOpenAPISchema()` (TC0), no copiandolas a
 * mano, que seria garantizar que el dia que la libreria cambie, este
 * contrato mienta.
 *
 * ponytail: una lista declarativa en vez de decorar cada ruta. Si el proyecto
 * crece hasta decenas de modulos, generar esto desde el router en tiempo de
 * arranque; con 4 modulos, la lista es mas legible que la magia.
 */
export interface RutaDocumentada {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  tag: string;
  summary: string;
  description?: string;
  auth?: boolean;
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
  /** El `data` del sobre de exito: el generador lo envuelve con {success, data, meta} o, si `paginated`, con el sobre de listado (`pagination`). */
  response?: ZodTypeAny;
  /** El listado va en un sobre `paginated` (con `pagination`), no en el de exito simple. */
  paginated?: boolean;
  status?: number;
  /** Codigos HTTP adicionales que puede devolver esta ruta, ademas de los genericos (401/403/422/429/500). */
  errors?: number[];
  /** Tipo del CUERPO de la peticion. Por defecto 'application/json'; 'text/csv' en `POST /imports/:table`. */
  contentType?: 'application/json' | 'text/csv';
  /** Tipo de la RESPUESTA de exito. Por defecto 'application/json' (el sobre estandar); 'text/csv' en exports y plantillas. */
  produces?: 'application/json' | 'text/csv';
}

/**
 * Toda ruta que no declara un `response` documentado, salvo las que no lo
 * necesitan: un `produces: 'text/csv'` describe su cuerpo de otra forma, y un
 * 204 no tiene cuerpo. La usan los tests de completitud de cada tarea (TC0-TC5,
 * uno por sus propios `tag`s) y TC6 (con todos los tags, cuando el resto haya
 * terminado).
 */
export function rutasSinResponseDocumentado(tags: readonly string[]): RutaDocumentada[] {
  return registroOpenApi.filter(
    (ruta) => tags.includes(ruta.tag) && !ruta.produces && ruta.status !== 204 && !ruta.response,
  );
}

export const registroOpenApi: RutaDocumentada[] = [
  // ─── users ─────────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/users/me',
    tag: 'users',
    summary: 'Mi perfil, con roles y permisos efectivos',
    auth: true,
    response: publicUserResponseSchema,
  },
  {
    method: 'patch',
    path: '/users/me',
    tag: 'users',
    summary: 'Editar mi perfil',
    description:
      'Schema separado del de administrador a proposito: no acepta `status`, que seria mass assignment.',
    auth: true,
    body: updateMeSchema,
    response: publicUserResponseSchema,
  },
  {
    method: 'get',
    path: '/users',
    tag: 'users',
    summary: 'Listar usuarios',
    description: 'Paginacion por cursor (recomendada) o por pagina. Requiere users:read.',
    auth: true,
    query: listUsersQuerySchema,
    response: publicUserResponseSchema,
    paginated: true,
  },
  {
    method: 'post',
    path: '/users',
    tag: 'users',
    summary: 'Crear un usuario',
    description: 'Requiere users:create. Asignar roles exige poseer ya sus permisos.',
    auth: true,
    body: createUserSchema,
    status: 201,
    response: publicUserResponseSchema,
    errors: [409],
  },
  {
    method: 'get',
    path: '/users/{id}',
    tag: 'users',
    summary: 'Ver un usuario',
    description: 'Requiere users:read o ser el dueño del recurso.',
    auth: true,
    params: idParamSchema,
    response: publicUserResponseSchema,
    errors: [404],
  },
  {
    method: 'patch',
    path: '/users/{id}',
    tag: 'users',
    summary: 'Editar un usuario (administrativo)',
    description: 'Requiere users:update. No permite administrar a alguien con mas privilegios.',
    auth: true,
    params: idParamSchema,
    body: updateUserSchema,
    response: publicUserResponseSchema,
    errors: [404],
  },
  {
    method: 'delete',
    path: '/users/{id}',
    tag: 'users',
    summary: 'Borrado logico de un usuario',
    description: 'Requiere users:delete. No permite borrar a alguien con mas privilegios.',
    auth: true,
    params: idParamSchema,
    status: 204,
  },
  {
    method: 'put',
    path: '/users/{id}/roles',
    tag: 'users',
    summary: 'Reemplazar los roles de un usuario',
    description:
      'Requiere users:assign-roles. Doble guarda: no se conceden permisos que no se poseen, ' +
      'y no se administra a un usuario con mas privilegios que el actor.',
    auth: true,
    params: idParamSchema,
    body: setUserRolesSchema,
    response: publicUserResponseSchema,
    errors: [404],
  },

  // ─── roles ─────────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/roles',
    tag: 'roles',
    summary: 'Listar roles',
    auth: true,
    query: listRolesQuerySchema,
    response: publicRoleResponseSchema,
    paginated: true,
  },
  {
    method: 'post',
    path: '/roles',
    tag: 'roles',
    summary: 'Crear un rol',
    description: 'Requiere roles:create. El comodin "*" no se puede asignar por API.',
    auth: true,
    body: createRoleSchema,
    status: 201,
    response: publicRoleResponseSchema,
    errors: [409],
  },
  {
    method: 'get',
    path: '/roles/{id}',
    tag: 'roles',
    summary: 'Ver un rol',
    auth: true,
    params: idParamSchema,
    response: publicRoleResponseSchema,
    errors: [404],
  },
  {
    method: 'patch',
    path: '/roles/{id}',
    tag: 'roles',
    summary: 'Editar un rol',
    description: 'Los roles de sistema son inmutables por API.',
    auth: true,
    params: idParamSchema,
    body: updateRoleSchema,
    response: publicRoleResponseSchema,
    errors: [404, 409],
  },
  {
    method: 'delete',
    path: '/roles/{id}',
    tag: 'roles',
    summary: 'Eliminar un rol vacio',
    auth: true,
    params: idParamSchema,
    status: 204,
    errors: [404, 409],
  },
  {
    method: 'put',
    path: '/roles/{id}/permissions',
    tag: 'roles',
    summary: 'Reemplazar los permisos de un rol',
    description: 'Requiere roles:assign-permissions. No se concede un permiso que el actor no posee.',
    auth: true,
    params: idParamSchema,
    body: setRolePermissionsSchema,
    response: publicRoleResponseSchema,
    errors: [404],
  },

  // ─── patients (TC2) ─────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/patients',
    tag: 'patients',
    summary: 'Listar pacientes',
    description:
      'Requiere patients:read. Sensible: se audita como data.sensitive.read (una fila con los ' +
      'filtros y el numero de resultados). Cursor entero (keyset por id) y filtros por sexo/regimen/' +
      'zona/departamento/municipio y rango de edad (a la fecha de referencia, no `now()`).',
    auth: true,
    query: listPatientsQuerySchema,
    response: publicPatientResponseSchema,
    paginated: true,
  },
  {
    method: 'post',
    path: '/patients',
    tag: 'patients',
    summary: 'Dar de alta un paciente',
    description: 'Requiere data:manage. El id es la clave natural del HIS (IdPaciente), no autoincremental.',
    auth: true,
    body: createPatientSchema,
    status: 201,
    response: publicPatientResponseSchema,
    errors: [409],
  },
  {
    method: 'get',
    path: '/patients/{id}',
    tag: 'patients',
    summary: 'Ver un paciente',
    description: 'Requiere patients:read. Sensible: se audita como data.sensitive.read. Nunca incluye birthDate.',
    auth: true,
    params: hisIdParamSchema,
    response: publicPatientResponseSchema,
    errors: [404],
  },
  {
    method: 'patch',
    path: '/patients/{id}',
    tag: 'patients',
    summary: 'Editar un paciente',
    description:
      'Requiere data:manage. Si el paciente tiene ingresos, se recalculan sus derivados ' +
      '(patientSex/Regime/Zone/Age snapshot en cada ingreso).',
    auth: true,
    params: hisIdParamSchema,
    body: updatePatientSchema,
    response: publicPatientResponseSchema,
    errors: [404],
  },
  {
    method: 'delete',
    path: '/patients/{id}',
    tag: 'patients',
    summary: 'Borrar un paciente',
    description: 'Requiere data:manage. 409 si tiene ingresos o triages que lo referencian.',
    auth: true,
    params: hisIdParamSchema,
    status: 204,
    errors: [404, 409],
  },

  // ─── admissions (TC2) ───────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/admissions',
    tag: 'admissions',
    summary: 'Listar ingresos',
    description:
      'Requiere services:read. Cursor entero y filtros por unit/admissionClass/entryRoute/' +
      'triageLevel/diagnosisCode/patientId y rango de admittedAt.',
    auth: true,
    query: listAdmissionsQuerySchema,
    response: publicAdmissionResponseSchema,
    paginated: true,
  },
  {
    method: 'post',
    path: '/admissions',
    tag: 'admissions',
    summary: 'Dar de alta un ingreso',
    description:
      'Requiere data:manage. El id es la clave natural del HIS (OidIngreso). virtualBed se deriva ' +
      'del nombre de cama; firstCareAt no se acepta aqui (PUT/DELETE /admissions/{id}/first-care).',
    auth: true,
    body: createAdmissionSchema,
    status: 201,
    response: publicAdmissionResponseSchema,
    errors: [409],
  },
  {
    method: 'get',
    path: '/admissions/{id}',
    tag: 'admissions',
    summary: 'Ver un ingreso',
    description: 'Requiere services:read. Incluye sus derivados y un resumen del triage vinculado.',
    auth: true,
    params: hisIdParamSchema,
    response: publicAdmissionResponseSchema,
    errors: [404],
  },
  {
    method: 'patch',
    path: '/admissions/{id}',
    tag: 'admissions',
    summary: 'Editar un ingreso',
    description:
      'Requiere data:manage. Recalcula sus derivados; invalida la fecha de referencia si cambia ' +
      'admittedAt. 409 si el triageId indicado ya esta en uso por otro ingreso.',
    auth: true,
    params: hisIdParamSchema,
    body: updateAdmissionSchema,
    response: publicAdmissionResponseSchema,
    errors: [404, 409],
  },
  {
    method: 'delete',
    path: '/admissions/{id}',
    tag: 'admissions',
    summary: 'Borrar un ingreso',
    description: 'Requiere data:manage. 409 si tiene registros de servicio o dispensaciones de medicamento.',
    auth: true,
    params: hisIdParamSchema,
    status: 204,
    errors: [404, 409],
  },
  {
    method: 'put',
    path: '/admissions/{id}/first-care',
    tag: 'admissions',
    summary: 'Registrar la primera atencion (Atencion.FechaAtencion) de un ingreso',
    description: 'Requiere data:manage. Unica via para tocar firstCareAt; recalcula waitMinutes.',
    auth: true,
    params: hisIdParamSchema,
    body: setFirstCareSchema,
    response: publicAdmissionResponseSchema,
    errors: [404],
  },
  {
    method: 'delete',
    path: '/admissions/{id}/first-care',
    tag: 'admissions',
    summary: 'Quitar la primera atencion registrada de un ingreso',
    description: 'Requiere data:manage. Vuelve firstCareAt y waitMinutes a null.',
    auth: true,
    params: hisIdParamSchema,
    response: publicAdmissionResponseSchema,
    errors: [404],
  },

  // ─── triages (TC2) ──────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/triages',
    tag: 'triages',
    summary: 'Listar triages',
    description: 'Requiere services:read. Cursor entero y filtros por level/patientId y rango de triagedAt.',
    auth: true,
    query: listTriagesQuerySchema,
    response: publicTriageResponseSchema,
    paginated: true,
  },
  {
    method: 'post',
    path: '/triages',
    tag: 'triages',
    summary: 'Dar de alta un triage',
    description: 'Requiere data:manage. El id es la clave natural del HIS (OidTriage).',
    auth: true,
    body: createTriageSchema,
    status: 201,
    response: publicTriageResponseSchema,
    errors: [409],
  },
  {
    method: 'get',
    path: '/triages/{id}',
    tag: 'triages',
    summary: 'Ver un triage',
    description: 'Requiere services:read.',
    auth: true,
    params: hisIdParamSchema,
    response: publicTriageResponseSchema,
    errors: [404],
  },
  {
    method: 'patch',
    path: '/triages/{id}',
    tag: 'triages',
    summary: 'Editar un triage',
    description:
      'Requiere data:manage. Si un ingreso lo tiene vinculado (triageId), se recalculan sus ' +
      'derivados (triageLevel/waitMinutes).',
    auth: true,
    params: hisIdParamSchema,
    body: updateTriageSchema,
    response: publicTriageResponseSchema,
    errors: [404],
  },
  {
    method: 'delete',
    path: '/triages/{id}',
    tag: 'triages',
    summary: 'Borrar un triage',
    description: 'Requiere data:manage. 409 si algun ingreso lo tiene vinculado (triageId).',
    auth: true,
    params: hisIdParamSchema,
    status: 204,
    errors: [404, 409],
  },

  // ─── permissions ───────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/permissions',
    tag: 'permissions',
    summary: 'Catalogo de permisos agrupado',
    description:
      'Solo lectura A PROPOSITO: el catalogo es contrato de codigo (core/rbac/permissions.ts + seed). ' +
      'Crearlos por API rompería el modelo de no-escalada (CLAUDE.md §5): un permiso nuevo se añade ' +
      'al codigo y se siembra, nunca se declara desde el cliente.',
    auth: true,
    response: permissionsListResponseSchema,
  },

  // ─── audit ─────────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/audit',
    tag: 'audit',
    summary: 'Consultar el rastro de auditoria',
    description: 'Requiere audit:read. La tabla es append-only: no hay escritura por API.',
    auth: true,
    query: listAuditQuerySchema,
    response: auditEntryResponseSchema,
    paginated: true,
  },
  {
    method: 'get',
    path: '/audit/{id}',
    tag: 'audit',
    summary: 'Ver un registro de auditoria',
    description: 'Requiere audit:read. Mismo DTO que el listado.',
    auth: true,
    params: idParamSchema,
    response: auditEntryResponseSchema,
    errors: [404],
  },

  // ─── alerts ────────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/alerts',
    tag: 'alerts',
    summary: 'Listar alertas operativas',
    description:
      'Requiere alerts:read. El listado se filtra ademas por ambito segun los permisos ' +
      'del actor (medications:read/services:read/surgeries:read via alcancesPorPermiso).',
    auth: true,
    query: listAlertsQuerySchema,
    response: publicAlertResponseSchema,
    paginated: true,
  },
  {
    method: 'post',
    path: '/alerts',
    tag: 'alerts',
    summary: 'Crear una alerta manual',
    description:
      'Requiere alerts:manage. Para un problema que el motor no detecta. `source` sale "manual" y ' +
      'value/threshold se guardan a 0 (no hay metrica real detras, TC5). Solo se puede crear en un ' +
      'ambito visible para el actor (alcancesPorPermiso); fuera de ambito responde 403. El motor NUNCA ' +
      'resuelve ni pisa una alerta manual (alerts.service.ts#sincronizar filtra por source).',
    auth: true,
    body: createManualAlertSchema,
    status: 201,
    response: publicAlertResponseSchema,
    errors: [403],
  },
  {
    method: 'get',
    path: '/alerts/{id}',
    tag: 'alerts',
    summary: 'Ver una alerta',
    description: 'Requiere alerts:read. Fuera del ambito del actor responde 404, igual que un id inexistente.',
    auth: true,
    params: idParamSchema,
    response: publicAlertResponseSchema,
    errors: [404],
  },
  {
    method: 'patch',
    path: '/alerts/{id}',
    tag: 'alerts',
    summary: 'Reconocer o resolver una alerta',
    description:
      'Requiere alerts:manage. Transiciones validas: OPEN->ACKNOWLEDGED, OPEN->RESOLVED, ' +
      'ACKNOWLEDGED->RESOLVED; cualquier otra devuelve 409.',
    auth: true,
    params: idParamSchema,
    body: updateAlertSchema,
    response: publicAlertResponseSchema,
    errors: [404, 409],
  },
  {
    method: 'delete',
    path: '/alerts/{id}',
    tag: 'alerts',
    summary: 'Borrar una alerta',
    description:
      'Requiere alerts:manage. Solo alertas manuales o RESOLVED; cualquier otra devuelve 409 ' +
      '(una alerta abierta del motor la recrearia la siguiente evaluacion).',
    auth: true,
    params: idParamSchema,
    status: 204,
    errors: [404, 409],
  },
  {
    method: 'post',
    path: '/alerts/evaluate',
    tag: 'alerts',
    summary: 'Disparar una evaluacion manual del motor de alertas',
    description:
      'Requiere alerts:manage. Sin cuerpo. Evalua las mismas metricas HIS que el job periodico ' +
      '(ALERT_EVAL_INTERVAL_MINUTES), con las reglas y umbrales de `AlertRule` (BD), y sincroniza ' +
      'el estado de las alertas.',
    auth: true,
    response: evaluateAlertsResponseSchema,
  },
  {
    method: 'get',
    path: '/alerts/rules',
    tag: 'alerts',
    summary: 'Listar las reglas del motor (umbrales y activacion)',
    description:
      'Requiere alerts:read. Las 5 reglas (una por tipo de alerta); los tipos los define el motor: ' +
      'no se crean ni se borran por API, solo se activan/desactivan y se cambian sus umbrales.',
    auth: true,
    response: z.array(alertRuleResponseSchema),
  },
  {
    method: 'get',
    path: '/alerts/rules/{type}',
    tag: 'alerts',
    summary: 'Ver una regla del motor',
    description: 'Requiere alerts:read.',
    auth: true,
    params: ruleTypeParamSchema,
    response: alertRuleResponseSchema,
    errors: [404],
  },
  {
    method: 'patch',
    path: '/alerts/rules/{type}',
    tag: 'alerts',
    summary: 'Activar/desactivar una regla o cambiar sus umbrales',
    description:
      'Requiere system:manage (no alerts:manage: cambiar el criterio del motor para TODOS los ' +
      'actores es administracion del sistema, no gestion de alertas). Una regla desactivada deja de ' +
      'generar alertas y resuelve las abiertas de su tipo en la siguiente evaluacion. Coherencia: en ' +
      'LOW_STOCK criticalThreshold < warningThreshold; en el resto (con nivel CRITICAL), > . Los tipos ' +
      'de un solo nivel (DEMAND_SPIKE, SURGERY_CANCELLATIONS) rechazan un criticalThreshold no nulo.',
    auth: true,
    params: ruleTypeParamSchema,
    body: updateRuleSchema,
    response: alertRuleResponseSchema,
    errors: [404],
  },

  // ─── assistant ─────────────────────────────────────────────────────────────
  {
    method: 'post',
    path: '/assistant/query',
    tag: 'assistant',
    summary: 'Preguntar al asistente de IA',
    description:
      'Requiere assistant:use. El agente Python no tiene autoridad: solo propone consultas ' +
      'en un DSL que Node valida contra el catalogo del usuario y ejecuta. La respuesta trae ' +
      'las filas que NODE ejecuto, nunca las que el agente dice. La API interna del agente ' +
      '(/internal/agent, segundo puerto) no se documenta aqui: no es publica.',
    auth: true,
    body: askSchema,
    response: assistantResponseSchema,
    errors: [403, 503, 502],
  },

  // ─── dashboard (T8) ────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/dashboard/summary',
    tag: 'dashboard',
    summary: 'Resumen del panel: ingresos, ocupacion, espera y alertas',
    description:
      'Requiere dashboard:read. El bloque de alertas solo aparece si el actor tiene ' +
      'algun ambito visible (medications:read/services:read/surgeries:read); si no tiene ' +
      'ninguno, se omite en vez de devolver un bloque vacio.',
    auth: true,
    query: dashboardQuerySchema,
    response: dashboardSummaryResponseSchema,
  },
  {
    method: 'get',
    path: '/dashboard/occupancy',
    tag: 'dashboard',
    summary: 'Ocupacion y censo estimados por unidad, con serie diaria',
    description:
      'Requiere dashboard:read y services:read. Estimacion sin fecha de egreso en el HIS ' +
      '(metodo "censo_estimado_ultima_actividad", B0): puede superar el 100% por las camas virtuales.',
    auth: true,
    query: dashboardQuerySchema,
    response: dashboardOccupancyResponseSchema,
  },
  {
    method: 'get',
    path: '/dashboard/wait-times',
    tag: 'dashboard',
    summary: 'Espera de triage a primera atencion, por nivel y en serie diaria',
    description: 'Requiere dashboard:read y services:read.',
    auth: true,
    query: dashboardQuerySchema,
    response: dashboardWaitTimesResponseSchema,
  },
  {
    method: 'get',
    path: '/dashboard/demand',
    tag: 'dashboard',
    summary: 'Demanda: ingresos por dia/unidad/via, perfil horario y cambio semanal',
    description: 'Requiere dashboard:read y services:read.',
    auth: true,
    query: dashboardQuerySchema,
    response: dashboardDemandResponseSchema,
  },

  // ─── analytics (T8) ────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/analytics/services',
    tag: 'analytics',
    summary: 'Volumen de servicios por area/especialidad y top procedimientos',
    description: 'Requiere analytics:read y services:read.',
    auth: true,
    query: analyticsQuerySchema,
    response: analyticsServicesResponseSchema,
  },
  {
    method: 'get',
    path: '/analytics/triage',
    tag: 'analytics',
    summary: 'Distribucion de triage, perfil horario y espera por nivel',
    description: 'Requiere analytics:read y services:read. La espera reusa wait-time.service.',
    auth: true,
    query: analyticsQuerySchema,
    response: analyticsTriageResponseSchema,
  },
  {
    method: 'get',
    path: '/analytics/services/export',
    tag: 'analytics',
    summary: 'Exportar el volumen de servicios por area/especialidad (CSV)',
    description: 'Requiere analytics:export, analytics:read y services:read.',
    auth: true,
    query: analyticsQuerySchema,
  },
  {
    method: 'get',
    path: '/analytics/triage/export',
    tag: 'analytics',
    summary: 'Exportar la espera por nivel de triage (CSV)',
    description: 'Requiere analytics:export, analytics:read y services:read.',
    auth: true,
    query: analyticsQuerySchema,
  },

  // ─── medications (T9 + TC4: detalle, catalogo, stock y dispensaciones) ─────
  {
    method: 'get',
    path: '/medications',
    tag: 'medications',
    summary: 'Catalogo de medicamentos e insumos',
    description:
      'Requiere medications:read. `search` es ILIKE escapado sobre el nombre. Sin stock ' +
      'registrado, avgDailyConsumption/daysOfInventory/risk/rotation son "insufficient_data".',
    auth: true,
    query: listMedicationsQuerySchema,
    response: medicationListItemResponseSchema,
    paginated: true,
  },
  {
    method: 'post',
    path: '/medications',
    tag: 'medications',
    summary: 'Dar de alta un medicamento o insumo en el catalogo',
    description: 'Requiere medications:manage. `code` es la clave natural del HIS (normalizada a mayusculas).',
    auth: true,
    body: createMedicationSchema,
    status: 201,
    response: medicationCatalogResponseSchema,
    errors: [409],
  },
  {
    method: 'get',
    path: '/medications/stock',
    tag: 'medications',
    summary: 'Listar el stock registrado, con su riesgo calculado',
    description:
      'Requiere medications:read. Paginado por pagina (pocas filas). `risk` filtra sobre un campo ' +
      'calculado (CRITICAL/LOW/OK/insufficient_data), no una columna: se calcula sobre toda la tabla ' +
      'y se pagina despues de filtrar.',
    auth: true,
    query: listStockQuerySchema,
    response: stockListItemResponseSchema,
    paginated: true,
  },
  {
    method: 'get',
    path: '/medications/dispenses',
    tag: 'medications',
    summary: 'Listar dispensaciones de medicamentos/insumos',
    description:
      'Requiere medications:read. Cursor entero (keyset por id) y filtros indexados: admissionId, ' +
      'code, area, specialty y rango de dispensedAt (desde/hasta).',
    auth: true,
    query: listDispensesQuerySchema,
    response: dispenseResponseSchema,
    paginated: true,
  },
  {
    method: 'post',
    path: '/medications/dispenses',
    tag: 'medications',
    summary: 'Registrar una dispensacion',
    description:
      'Requiere data:manage (NO medications:manage: FARMACIA gestiona catalogo y stock pero no ' +
      'dispensa por API, C0). El id es la clave natural del HIS (OidMI), no se autogenera. ' +
      'Recalcula lastActivityAt/stayHours del ingreso enlazado.',
    auth: true,
    body: createDispenseSchema,
    status: 201,
    response: dispenseResponseSchema,
    errors: [400, 409],
  },
  {
    method: 'get',
    path: '/medications/dispenses/{id}',
    tag: 'medications',
    summary: 'Ver una dispensacion',
    description: 'Requiere medications:read.',
    auth: true,
    params: hisIdParamSchema,
    response: dispenseResponseSchema,
    errors: [404],
  },
  {
    method: 'patch',
    path: '/medications/dispenses/{id}',
    tag: 'medications',
    summary: 'Editar una dispensacion',
    description:
      'Requiere data:manage. Si `admissionId` cambia, recalcula los derivados del ingreso VIEJO y del NUEVO.',
    auth: true,
    params: hisIdParamSchema,
    body: updateDispenseSchema,
    response: dispenseResponseSchema,
    errors: [400, 404],
  },
  {
    method: 'delete',
    path: '/medications/dispenses/{id}',
    tag: 'medications',
    summary: 'Borrar una dispensacion',
    description: 'Requiere data:manage. Recalcula los derivados del ingreso enlazado.',
    auth: true,
    params: hisIdParamSchema,
    status: 204,
    errors: [404],
  },
  {
    method: 'get',
    path: '/medications/critical',
    tag: 'medications',
    summary: 'Medicamentos en riesgo CRITICAL o LOW',
    description:
      'Requiere medications:read. Sin ningun stock registrado responde ' +
      '{ status: "insufficient_data", items: [] }.',
    auth: true,
    response: criticalMedicationsResponseSchema,
  },
  {
    method: 'get',
    path: '/medications/consumption',
    tag: 'medications',
    summary: 'Serie de consumo, top 10 y desglose por area',
    description: 'Requiere medications:read.',
    auth: true,
    query: consumptionQuerySchema,
    response: consumptionResponseSchema,
  },
  {
    method: 'put',
    path: '/medications/{code}/stock',
    tag: 'medications',
    summary: 'Registrar el stock actual de un medicamento o insumo',
    description: 'Requiere medications:manage. El HIS no trae stock (B0): lo mantiene FARMACIA por API.',
    auth: true,
    params: codeParamSchema,
    body: updateStockSchema,
    response: stockResponseSchema,
  },
  {
    method: 'delete',
    path: '/medications/{code}/stock',
    tag: 'medications',
    summary: 'Borrar el registro de stock de un medicamento o insumo',
    description: 'Requiere medications:manage.',
    auth: true,
    params: codeParamSchema,
    status: 204,
    errors: [404],
  },
  {
    method: 'get',
    path: '/medications/{code}',
    tag: 'medications',
    summary: 'Detalle de un medicamento o insumo',
    description:
      'Requiere medications:read. Catalogo + stock + consumo de 30 dias + dias de inventario + riesgo.',
    auth: true,
    params: codeParamSchema,
    response: medicationDetailResponseSchema,
    errors: [404],
  },
  {
    method: 'patch',
    path: '/medications/{code}',
    tag: 'medications',
    summary: 'Editar el nombre/tipo de un medicamento o insumo',
    description: 'Requiere medications:manage. `code` es la clave natural: inmutable por API.',
    auth: true,
    params: codeParamSchema,
    body: updateMedicationSchema,
    response: medicationCatalogResponseSchema,
    errors: [404],
  },
  {
    method: 'delete',
    path: '/medications/{code}',
    tag: 'medications',
    summary: 'Eliminar un medicamento o insumo del catalogo',
    description: 'Requiere medications:manage. 409 si tiene dispensaciones o un registro de stock.',
    auth: true,
    params: codeParamSchema,
    status: 204,
    errors: [404, 409],
  },

  // ─── surgeries (T9) ────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/analytics/surgeries',
    tag: 'surgeries',
    summary: 'Resumen de cirugias programadas',
    description:
      'Requiere analytics:read y surgeries:read. Sin periodo: ProgramacionCirugia no trae ' +
      'fecha en el HIS (B0). `executed` desconocido = sin ingreso verificable en el extracto.',
    auth: true,
    query: emptyQuerySchema,
    response: surgeriesSummaryResponseSchema,
  },
  {
    method: 'get',
    path: '/analytics/surgeries/export',
    tag: 'surgeries',
    summary: 'Exportar el detalle de cirugias programadas (CSV)',
    description: 'Requiere analytics:export, analytics:read y surgeries:read.',
    auth: true,
    query: emptyQuerySchema,
  },

  // ─── service-records (TC3) ─────────────────────────────────────────────────
  {
    method: 'get',
    path: '/service-records',
    tag: 'service-records',
    summary: 'Listar registros de servicio prestado',
    description:
      'Requiere services:read. Cursor entero (keyset por id) y filtros indexados: admissionId, code, ' +
      'area, specialty y rango de providedAt (desde/hasta).',
    auth: true,
    query: listServiceRecordsQuerySchema,
    response: serviceRecordResponseSchema,
    paginated: true,
  },
  {
    method: 'post',
    path: '/service-records',
    tag: 'service-records',
    summary: 'Registrar un servicio prestado',
    description:
      'Requiere data:manage. El id es la clave natural del HIS (OidS), no se autogenera. Si `code` no ' +
      'existe en el catalogo de procedimientos, se da de alta con `procedureName` (obligatorio en ese ' +
      'caso). Recalcula lastActivityAt del ingreso y el executed de sus cirugias programadas.',
    auth: true,
    body: createServiceRecordSchema,
    status: 201,
    response: serviceRecordResponseSchema,
    errors: [404, 409],
  },
  {
    method: 'get',
    path: '/service-records/{id}',
    tag: 'service-records',
    summary: 'Ver un registro de servicio',
    auth: true,
    params: hisIdParamSchema,
    response: serviceRecordResponseSchema,
    errors: [404],
  },
  {
    method: 'patch',
    path: '/service-records/{id}',
    tag: 'service-records',
    summary: 'Editar un registro de servicio',
    description:
      'Requiere data:manage. `admissionId` es inmutable. `executed` no existe en este recurso (es ' +
      'derivado, propio de surgery-schedules): enviarlo responde 422 (schema `.strict()`).',
    auth: true,
    params: hisIdParamSchema,
    body: updateServiceRecordSchema,
    response: serviceRecordResponseSchema,
    errors: [404],
  },
  {
    method: 'delete',
    path: '/service-records/{id}',
    tag: 'service-records',
    summary: 'Borrar un registro de servicio',
    description: 'Requiere data:manage. Recalcula lastActivityAt del ingreso y el executed de sus cirugias.',
    auth: true,
    params: hisIdParamSchema,
    status: 204,
    errors: [404],
  },

  // ─── procedures (TC3) ──────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/procedures',
    tag: 'procedures',
    summary: 'Listar el catalogo de procedimientos (CUPS)',
    description: 'Requiere services:read. Cursor alfabetico sobre `code` (PK string, no entera).',
    auth: true,
    query: listProceduresQuerySchema,
    response: procedureResponseSchema,
    paginated: true,
  },
  {
    method: 'post',
    path: '/procedures',
    tag: 'procedures',
    summary: 'Dar de alta un procedimiento en el catalogo',
    description: 'Requiere data:manage.',
    auth: true,
    body: createProcedureSchema,
    status: 201,
    response: procedureResponseSchema,
    errors: [409],
  },
  {
    method: 'get',
    path: '/procedures/{code}',
    tag: 'procedures',
    summary: 'Ver un procedimiento',
    auth: true,
    params: procedureCodeParamSchema,
    response: procedureResponseSchema,
    errors: [404],
  },
  {
    method: 'patch',
    path: '/procedures/{code}',
    tag: 'procedures',
    summary: 'Editar el nombre de un procedimiento',
    description: 'Requiere data:manage. `code` es la clave natural: inmutable por API.',
    auth: true,
    params: procedureCodeParamSchema,
    body: updateProcedureSchema,
    response: procedureResponseSchema,
    errors: [404],
  },
  {
    method: 'delete',
    path: '/procedures/{code}',
    tag: 'procedures',
    summary: 'Eliminar un procedimiento sin registros de servicio',
    description:
      'Requiere data:manage. 409 si tiene registros de servicio asociados (his_service_records.code ' +
      'referencia con ON DELETE RESTRICT).',
    auth: true,
    params: procedureCodeParamSchema,
    status: 204,
    errors: [404, 409],
  },

  // ─── surgery-schedules (TC3) ───────────────────────────────────────────────
  {
    method: 'get',
    path: '/surgery-schedules',
    tag: 'surgery-schedules',
    summary: 'Listar la programacion de cirugias',
    description:
      'Requiere surgeries:read. Cursor entero (keyset por id) y filtros: scheduleNumber, admissionId, ' +
      'procedureCode, executed.',
    auth: true,
    query: listSurgerySchedulesQuerySchema,
    response: surgeryScheduleResponseSchema,
    paginated: true,
  },
  {
    method: 'post',
    path: '/surgery-schedules',
    tag: 'surgery-schedules',
    summary: 'Programar una cirugia',
    description:
      'Requiere data:manage. `id` es autoincremental (unica de las 6 entidades HIS sin clave natural ' +
      'utilizable, B0): no se envia en el POST. `executed` es un derivado de solo lectura: enviarlo ' +
      'responde 422 (schema `.strict()`); lo calcula el servidor segun admissionId/procedureCode.',
    auth: true,
    body: createSurgeryScheduleSchema,
    status: 201,
    response: surgeryScheduleResponseSchema,
    errors: [409],
  },
  {
    method: 'get',
    path: '/surgery-schedules/{id}',
    tag: 'surgery-schedules',
    summary: 'Ver una cirugia programada',
    auth: true,
    params: hisIdParamSchema,
    response: surgeryScheduleResponseSchema,
    errors: [404],
  },
  {
    method: 'patch',
    path: '/surgery-schedules/{id}',
    tag: 'surgery-schedules',
    summary: 'Editar una cirugia programada',
    description: 'Requiere data:manage. `executed` no se acepta (422): se recalcula tras el cambio.',
    auth: true,
    params: hisIdParamSchema,
    body: updateSurgeryScheduleSchema,
    response: surgeryScheduleResponseSchema,
    errors: [404],
  },
  {
    method: 'delete',
    path: '/surgery-schedules/{id}',
    tag: 'surgery-schedules',
    summary: 'Borrar una cirugia programada',
    description: 'Requiere data:manage. Sin dependientes: ninguna otra tabla referencia este recurso.',
    auth: true,
    params: hisIdParamSchema,
    status: 204,
    errors: [404],
  },

  // ─── imports (TC1) ─────────────────────────────────────────────────────────
  {
    method: 'post',
    path: '/imports/{table}',
    tag: 'imports',
    summary: 'Subir un archivo CSV/HIS para importar una tabla',
    description:
      'Requiere data:import. Cuerpo `text/csv` (el archivo en crudo), `?fileName=` opcional. ' +
      'Separador detectado por la cabecera: `|` nativo sin comillas, o `,`/`;` con comillas RFC 4180. ' +
      'Se guarda en un temporal, se crea el ImportJob y responde 202: el proceso sigue en segundo ' +
      'plano (consultar con GET /imports/{id}). 409 si ya hay otro trabajo en curso. 413 si el ' +
      'archivo supera IMPORT_MAX_MB.',
    auth: true,
    params: tablaParamSchema,
    query: fileNameQuerySchema,
    contentType: 'text/csv',
    status: 202,
    response: importJobResponseSchema,
    errors: [409, 413, 415],
  },
  {
    method: 'get',
    path: '/imports',
    tag: 'imports',
    summary: 'Listar trabajos de importacion',
    description: 'Requiere data:import. Cursor UUID (keyset por id) y filtros por status y table.',
    auth: true,
    query: listImportsQuerySchema,
    response: importJobResponseSchema,
    paginated: true,
  },
  {
    method: 'get',
    path: '/imports/templates/{table}',
    tag: 'imports',
    summary: 'Plantilla CSV de una tabla (cabecera + fila de ejemplo sintetica)',
    description: 'Requiere data:import. La cabecera es EXACTA a la que exige la importacion de esa tabla.',
    auth: true,
    params: tablaParamSchema,
    produces: 'text/csv',
  },
  {
    method: 'get',
    path: '/imports/{id}',
    tag: 'imports',
    summary: 'Ver un trabajo de importacion',
    description:
      'Requiere data:import. Incluye los contadores y los primeros 50 errores (linea + motivo, ' +
      'nunca datos de paciente).',
    auth: true,
    params: idParamSchema,
    response: importJobResponseSchema,
    errors: [404],
  },
  {
    method: 'delete',
    path: '/imports/{id}',
    tag: 'imports',
    summary: 'Borrar el registro de un trabajo de importacion',
    description:
      'Requiere data:import. Borra solo el METADATO de la subida, nunca los datos ya importados. ' +
      '409 si el trabajo esta PENDING o RUNNING.',
    auth: true,
    params: idParamSchema,
    status: 204,
    errors: [404, 409],
  },

  // ─── health ────────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/health',
    tag: 'health',
    summary: 'Liveness: no toca dependencias',
    response: livenessResponseSchema,
  },
  {
    method: 'get',
    path: '/health/ready',
    tag: 'health',
    summary: 'Readiness: comprueba BD y Redis',
    description: '503 si alguna dependencia obligatoria (BD, o Redis con REDIS_URL configurada) esta caida.',
    response: readinessResponseSchema,
    errors: [503],
  },
  {
    method: 'get',
    path: '/health/startup',
    tag: 'health',
    summary: 'Startup probe',
    response: startupResponseSchema,
    errors: [503],
  },

  // ─── indice ────────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '',
    tag: 'index',
    summary: 'Indice de la API: nombre, entorno y rutas montadas',
    response: indexResponseSchema,
  },
];
