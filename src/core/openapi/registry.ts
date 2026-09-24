import type { ZodTypeAny } from 'zod';
import {
  createUserSchema,
  listUsersQuerySchema,
  setUserRolesSchema,
  updateMeSchema,
  updateUserSchema,
} from '../../modules/users/users.schemas';
import {
  createRoleSchema,
  listRolesQuerySchema,
  setRolePermissionsSchema,
  updateRoleSchema,
} from '../../modules/roles/roles.schemas';
import { listAuditQuerySchema } from '../../modules/audit/audit.schemas';
import { listAlertsQuerySchema, updateAlertSchema } from '../../modules/alerts/alerts.schemas';
import { askSchema } from '../../modules/assistant/assistant.schemas';
import { dashboardQuerySchema } from '../../modules/dashboard/dashboard.schemas';
import { analyticsQuerySchema } from '../../modules/analytics/analytics.schemas';
import {
  codeParamSchema,
  consumptionQuerySchema,
  listMedicationsQuerySchema,
  updateStockSchema,
} from '../../modules/medications/medications.schemas';
import { emptyQuerySchema } from '../../modules/surgeries/surgeries.schemas';
import { idParamSchema } from '../http/schemas';

/**
 * Registro de rutas para el contrato OpenAPI.
 *
 * Se referencian los MISMOS objetos Zod que usa `validate()`: si un schema
 * cambia, el contrato cambia con el. No hay forma de que se desincronicen.
 *
 * Las rutas bajo /auth NO estan aqui: las sirve Better Auth y las documenta el
 * plugin `openAPI` en {API_PREFIX}/auth/reference. Copiarlas a mano seria
 * garantizar que el dia que la libreria cambie, este contrato mienta.
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
  response?: ZodTypeAny;
  status?: number;
}

export const registroOpenApi: RutaDocumentada[] = [
  // ─── users ─────────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/users/me',
    tag: 'users',
    summary: 'Mi perfil, con roles y permisos efectivos',
    auth: true,
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
  },
  {
    method: 'get',
    path: '/users',
    tag: 'users',
    summary: 'Listar usuarios',
    description: 'Paginacion por cursor (recomendada) o por pagina. Requiere users:read.',
    auth: true,
    query: listUsersQuerySchema,
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
  },
  {
    method: 'get',
    path: '/users/{id}',
    tag: 'users',
    summary: 'Ver un usuario',
    description: 'Requiere users:read o ser el dueño del recurso.',
    auth: true,
    params: idParamSchema,
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
  },

  // ─── roles ─────────────────────────────────────────────────────────────────
  { method: 'get', path: '/roles', tag: 'roles', summary: 'Listar roles', auth: true, query: listRolesQuerySchema },
  {
    method: 'post',
    path: '/roles',
    tag: 'roles',
    summary: 'Crear un rol',
    description: 'Requiere roles:create. El comodin "*" no se puede asignar por API.',
    auth: true,
    body: createRoleSchema,
    status: 201,
  },
  { method: 'get', path: '/roles/{id}', tag: 'roles', summary: 'Ver un rol', auth: true, params: idParamSchema },
  {
    method: 'patch',
    path: '/roles/{id}',
    tag: 'roles',
    summary: 'Editar un rol',
    description: 'Los roles de sistema son inmutables por API.',
    auth: true,
    params: idParamSchema,
    body: updateRoleSchema,
  },
  {
    method: 'delete',
    path: '/roles/{id}',
    tag: 'roles',
    summary: 'Eliminar un rol vacio',
    auth: true,
    params: idParamSchema,
    status: 204,
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
  },

  // ─── permissions ───────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/permissions',
    tag: 'permissions',
    summary: 'Catalogo de permisos agrupado',
    description: 'Solo lectura: los permisos se declaran en el codigo y se siembran.',
    auth: true,
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
  },
  {
    method: 'get',
    path: '/alerts/{id}',
    tag: 'alerts',
    summary: 'Ver una alerta',
    description: 'Requiere alerts:read. Fuera del ambito del actor responde 404, igual que un id inexistente.',
    auth: true,
    params: idParamSchema,
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
  },
  {
    method: 'post',
    path: '/alerts/evaluate',
    tag: 'alerts',
    summary: 'Disparar una evaluacion manual del motor de alertas',
    description:
      'Requiere alerts:manage. Sin cuerpo. Evalua las mismas metricas HIS que el job periodico ' +
      '(ALERT_EVAL_INTERVAL_MINUTES) y sincroniza el estado de las alertas. Responde ' +
      '{ creadas, actualizadas, resueltas, evaluadoEn }.',
    auth: true,
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
  },
  {
    method: 'get',
    path: '/dashboard/wait-times',
    tag: 'dashboard',
    summary: 'Espera de triage a primera atencion, por nivel y en serie diaria',
    description: 'Requiere dashboard:read y services:read.',
    auth: true,
    query: dashboardQuerySchema,
  },
  {
    method: 'get',
    path: '/dashboard/demand',
    tag: 'dashboard',
    summary: 'Demanda: ingresos por dia/unidad/via, perfil horario y cambio semanal',
    description: 'Requiere dashboard:read y services:read.',
    auth: true,
    query: dashboardQuerySchema,
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
  },
  {
    method: 'get',
    path: '/analytics/triage',
    tag: 'analytics',
    summary: 'Distribucion de triage, perfil horario y espera por nivel',
    description: 'Requiere analytics:read y services:read. La espera reusa wait-time.service.',
    auth: true,
    query: analyticsQuerySchema,
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

  // ─── medications (T9) ──────────────────────────────────────────────────────
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
  },
  {
    method: 'get',
    path: '/medications/consumption',
    tag: 'medications',
    summary: 'Serie de consumo, top 10 y desglose por area',
    description: 'Requiere medications:read.',
    auth: true,
    query: consumptionQuerySchema,
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

  // ─── health ────────────────────────────────────────────────────────────────
  { method: 'get', path: '/health', tag: 'health', summary: 'Liveness: no toca dependencias' },
  { method: 'get', path: '/health/ready', tag: 'health', summary: 'Readiness: comprueba BD y Redis' },
  { method: 'get', path: '/health/startup', tag: 'health', summary: 'Startup probe' },
];
