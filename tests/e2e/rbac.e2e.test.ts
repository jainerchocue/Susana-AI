import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { env } from '../../src/config/env';
import { PERMISSIONS, SYSTEM_ROLES, WILDCARD_PERMISSION } from '../../src/core/rbac/permissions';
import { comoRol, prismaE2E, Sesion } from './cliente';
import type { Respuesta } from './cliente';

/**
 * T14 (E2, BD `hospital_e2e_b`, puerto 3220): matriz RBAC E2E completa.
 *
 * Fuente de verdad: `SYSTEM_ROLES` (mismo catalogo que siembra la BD) y los
 * permisos que exige cada ruta, leidos de cada `*.routes.ts` (no inventados).
 * Cubre TODOS los endpoints publicos de `registry.ts` salvo `/auth/**`
 * (los sirve Better Auth, T13 la prueba aparte) y `/assistant/query` (chat
 * fuera de alcance, E0). `health` tambien queda fuera: a diferencia de todo lo
 * demas no exige `authenticate` ni ningun permiso (T12 ya la prueba), asi que
 * no encaja en el contrato "sin sesion -> 401 / con sesion -> permitido o
 * 403" que esta matriz verifica; incluirla forzaria una fila que documentaria
 * un comportamiento distinto al que se esta probando aqui.
 *
 * "permitido" = la peticion pasa `authenticate` y `requirePermissions` (no
 * responde 401 ni 403). Lo que el controlador haga despues (200/404/409/422)
 * no es lo que se prueba en esta matriz. Las rutas mutantes que resultan
 * permitidas se ejercen con un id inexistente (404 tras autorizar) o con
 * datos propios de este archivo, para no alterar a otros.
 */

const BASE = inject('e2eUrl');
const PREFIJO = env.API_PREFIX;
const idInexistente = randomUUID();
/** Codigo de medicamento inventado, exclusivo de esta matriz: no colisiona con el catalogo HIS. */
const CODIGO_STOCK_MATRIZ = 'RBACMATRIX';

interface EndpointCaso {
  nombre: string;
  /** Permisos que la ruta exige TODOS (modo 'all' de requirePermissions), en el orden de su *.routes.ts. Vacio = solo authenticate. */
  permisos: string[];
  /**
   * Solo para `POST /alerts` (manual): ademas de `permisos`, el SERVICIO exige
   * (`alcancesPorPermiso` sobre `scope`, C0) al menos uno de estos. Mismo
   * mecanismo que en `tests/security/rbac-matriz.test.ts`, no una puerta
   * duplicada fuera del middleware.
   */
  permisosAlguno?: string[];
  llamar: (sesion: Sesion) => Promise<Respuesta>;
}

function ruta(sufijo: string): string {
  return `${PREFIJO}${sufijo}`;
}

const ENDPOINTS: EndpointCaso[] = [
  // ─── users ───────────────────────────────────────────────────────────────
  { nombre: 'GET /users/me', permisos: [], llamar: (s) => s.get(ruta('/users/me')) },
  {
    nombre: 'PATCH /users/me',
    permisos: [],
    llamar: (s) => s.patch(ruta('/users/me'), { name: 'RBAC Matrix' }),
  },
  { nombre: 'GET /users', permisos: [PERMISSIONS.users.read], llamar: (s) => s.get(ruta('/users')) },
  {
    nombre: 'POST /users',
    permisos: [PERMISSIONS.users.create],
    llamar: (s) =>
      s.post(ruta('/users'), {
        email: `e2e-rbac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`,
        password: 'HospitalIntel2026!Segura',
        name: 'RBAC Matrix',
        roles: [],
      }),
  },
  {
    nombre: 'GET /users/:id',
    permisos: [PERMISSIONS.users.read],
    llamar: (s) => s.get(ruta(`/users/${idInexistente}`)),
  },
  {
    nombre: 'PATCH /users/:id',
    permisos: [PERMISSIONS.users.update],
    llamar: (s) => s.patch(ruta(`/users/${idInexistente}`), { name: 'RBAC Matrix' }),
  },
  {
    nombre: 'DELETE /users/:id',
    permisos: [PERMISSIONS.users.delete],
    llamar: (s) => s.delete(ruta(`/users/${idInexistente}`)),
  },
  {
    nombre: 'PUT /users/:id/roles',
    permisos: [PERMISSIONS.users.assignRoles],
    llamar: (s) => s.put(ruta(`/users/${idInexistente}/roles`), { roles: [] }),
  },

  // ─── roles ───────────────────────────────────────────────────────────────
  { nombre: 'GET /roles', permisos: [PERMISSIONS.roles.read], llamar: (s) => s.get(ruta('/roles')) },
  {
    nombre: 'POST /roles',
    permisos: [PERMISSIONS.roles.create],
    llamar: (s) =>
      s.post(ruta('/roles'), {
        name: `e2e-rbac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        permissions: [],
      }),
  },
  {
    nombre: 'GET /roles/:id',
    permisos: [PERMISSIONS.roles.read],
    llamar: (s) => s.get(ruta(`/roles/${idInexistente}`)),
  },
  {
    nombre: 'PATCH /roles/:id',
    permisos: [PERMISSIONS.roles.update],
    llamar: (s) => s.patch(ruta(`/roles/${idInexistente}`), { description: 'x' }),
  },
  {
    nombre: 'DELETE /roles/:id',
    permisos: [PERMISSIONS.roles.delete],
    llamar: (s) => s.delete(ruta(`/roles/${idInexistente}`)),
  },
  {
    nombre: 'PUT /roles/:id/permissions',
    permisos: [PERMISSIONS.roles.assignPermissions],
    llamar: (s) => s.put(ruta(`/roles/${idInexistente}/permissions`), { permissions: [] }),
  },

  // ─── permissions ─────────────────────────────────────────────────────────
  {
    nombre: 'GET /permissions',
    permisos: [PERMISSIONS.permissions.read],
    llamar: (s) => s.get(ruta('/permissions')),
  },

  // ─── audit ───────────────────────────────────────────────────────────────
  { nombre: 'GET /audit', permisos: [PERMISSIONS.audit.read], llamar: (s) => s.get(ruta('/audit')) },

  // ─── alerts ──────────────────────────────────────────────────────────────
  { nombre: 'GET /alerts', permisos: [PERMISSIONS.alerts.read], llamar: (s) => s.get(ruta('/alerts')) },
  {
    nombre: 'GET /alerts/:id',
    permisos: [PERMISSIONS.alerts.read],
    llamar: (s) => s.get(ruta(`/alerts/${idInexistente}`)),
  },
  {
    nombre: 'PATCH /alerts/:id',
    permisos: [PERMISSIONS.alerts.manage],
    llamar: (s) => s.patch(ruta(`/alerts/${idInexistente}`), { status: 'RESOLVED' }),
  },
  {
    nombre: 'POST /alerts/evaluate',
    permisos: [PERMISSIONS.alerts.manage],
    llamar: (s) => s.post(ruta('/alerts/evaluate')),
  },

  // ─── dashboard ───────────────────────────────────────────────────────────
  {
    nombre: 'GET /dashboard/summary',
    permisos: [PERMISSIONS.dashboard.read],
    llamar: (s) => s.get(ruta('/dashboard/summary')),
  },
  {
    nombre: 'GET /dashboard/occupancy',
    permisos: [PERMISSIONS.dashboard.read, PERMISSIONS.services.read],
    llamar: (s) => s.get(ruta('/dashboard/occupancy')),
  },
  {
    nombre: 'GET /dashboard/wait-times',
    permisos: [PERMISSIONS.dashboard.read, PERMISSIONS.services.read],
    llamar: (s) => s.get(ruta('/dashboard/wait-times')),
  },
  {
    nombre: 'GET /dashboard/demand',
    permisos: [PERMISSIONS.dashboard.read, PERMISSIONS.services.read],
    llamar: (s) => s.get(ruta('/dashboard/demand')),
  },

  // ─── analytics ───────────────────────────────────────────────────────────
  {
    nombre: 'GET /analytics/services',
    permisos: [PERMISSIONS.analytics.read, PERMISSIONS.services.read],
    llamar: (s) => s.get(ruta('/analytics/services')),
  },
  {
    nombre: 'GET /analytics/triage',
    permisos: [PERMISSIONS.analytics.read, PERMISSIONS.services.read],
    llamar: (s) => s.get(ruta('/analytics/triage')),
  },
  {
    nombre: 'GET /analytics/services/export',
    permisos: [PERMISSIONS.analytics.export, PERMISSIONS.analytics.read, PERMISSIONS.services.read],
    llamar: (s) => s.get(ruta('/analytics/services/export')),
  },
  {
    nombre: 'GET /analytics/triage/export',
    permisos: [PERMISSIONS.analytics.export, PERMISSIONS.analytics.read, PERMISSIONS.services.read],
    llamar: (s) => s.get(ruta('/analytics/triage/export')),
  },

  // ─── medications ─────────────────────────────────────────────────────────
  {
    nombre: 'GET /medications',
    permisos: [PERMISSIONS.medications.read],
    llamar: (s) => s.get(ruta('/medications')),
  },
  {
    nombre: 'GET /medications/critical',
    permisos: [PERMISSIONS.medications.read],
    llamar: (s) => s.get(ruta('/medications/critical')),
  },
  {
    nombre: 'GET /medications/consumption',
    permisos: [PERMISSIONS.medications.read],
    llamar: (s) => s.get(ruta('/medications/consumption')),
  },
  {
    nombre: 'PUT /medications/:code/stock',
    permisos: [PERMISSIONS.medications.manage],
    llamar: (s) => s.put(ruta(`/medications/${CODIGO_STOCK_MATRIZ}/stock`), { quantity: 5 }),
  },

  // ─── surgeries (montado bajo /analytics/surgeries) ─────────────────────────
  {
    nombre: 'GET /analytics/surgeries',
    permisos: [PERMISSIONS.analytics.read, PERMISSIONS.surgeries.read],
    llamar: (s) => s.get(ruta('/analytics/surgeries')),
  },
  {
    nombre: 'GET /analytics/surgeries/export',
    permisos: [PERMISSIONS.analytics.export, PERMISSIONS.analytics.read, PERMISSIONS.surgeries.read],
    llamar: (s) => s.get(ruta('/analytics/surgeries/export')),
  },

  // ─── TC6: rutas nuevas de C-1 (CRUD HIS, imports, alertas/reglas, audit) ────
  // Ids sinteticos >= 9.950.000 (rango propio de esta suite, C0: ">= 9.000.000")
  // y codigos con prefijo `ZE2E` (el global-setup los limpia en la siguiente
  // corrida). Cuerpos siempre validos: con `validate` antes de
  // `requirePermissions` en algunas rutas (orden canonico, CLAUDE.md §5), un
  // cuerpo invalido daria 422 en vez de 403 y enmascararia el propio permiso.

  // ─── patients ────────────────────────────────────────────────────────────
  { nombre: 'GET /patients', permisos: [PERMISSIONS.patients.read], llamar: (s) => s.get(ruta('/patients')) },
  {
    nombre: 'POST /patients',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) =>
      s.post(ruta('/patients'), {
        id: 9_950_001,
        documentType: 'CC',
        birthDate: '2000-01-01',
        sex: 'Masculino',
        insurer: 'EPS RBAC E2E',
        regime: 'Contributivo',
        department: 'RBAC',
        municipality: 'RBAC',
        zone: 'Urbana',
      }),
  },
  {
    nombre: 'GET /patients/:id',
    permisos: [PERMISSIONS.patients.read],
    llamar: (s) => s.get(ruta('/patients/9950999')),
  },
  {
    nombre: 'PATCH /patients/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.patch(ruta('/patients/9950999'), { zone: 'Rural' }),
  },
  {
    nombre: 'DELETE /patients/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.delete(ruta('/patients/9950999')),
  },

  // ─── admissions ──────────────────────────────────────────────────────────
  { nombre: 'GET /admissions', permisos: [PERMISSIONS.services.read], llamar: (s) => s.get(ruta('/admissions')) },
  {
    nombre: 'POST /admissions',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) =>
      s.post(ruta('/admissions'), {
        id: 9_950_101,
        consecutive: 1,
        patientId: 9_999_999,
        admissionClass: 'URGENCIAS',
        entryRoute: 'REMITIDO',
        riskType: 'GENERAL',
        admittedAt: '2026-06-01T08:00:00-05:00',
        bedCode: 'B1',
        bedName: 'CAMA RBAC',
        unit: 'URGENCIAS',
        subunit: 'RBAC',
      }),
  },
  {
    nombre: 'GET /admissions/:id',
    permisos: [PERMISSIONS.services.read],
    llamar: (s) => s.get(ruta('/admissions/9950999')),
  },
  {
    nombre: 'PATCH /admissions/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.patch(ruta('/admissions/9950999'), { subunit: 'RBAC-2' }),
  },
  {
    nombre: 'DELETE /admissions/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.delete(ruta('/admissions/9950999')),
  },
  {
    nombre: 'PUT /admissions/:id/first-care',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.put(ruta('/admissions/9950999/first-care'), { firstCareAt: '2026-06-01T08:00:00-05:00' }),
  },
  {
    nombre: 'DELETE /admissions/:id/first-care',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.delete(ruta('/admissions/9950999/first-care')),
  },

  // ─── triages ─────────────────────────────────────────────────────────────
  { nombre: 'GET /triages', permisos: [PERMISSIONS.services.read], llamar: (s) => s.get(ruta('/triages')) },
  {
    nombre: 'POST /triages',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) =>
      s.post(ruta('/triages'), {
        id: 9_950_201,
        triagedAt: '2026-06-01T08:00:00-05:00',
        code: 'RBAC1',
        classification: 'TRIAGE RBAC (VERDE)',
      }),
  },
  {
    nombre: 'GET /triages/:id',
    permisos: [PERMISSIONS.services.read],
    llamar: (s) => s.get(ruta('/triages/9950999')),
  },
  {
    nombre: 'PATCH /triages/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.patch(ruta('/triages/9950999'), { classification: 'RBAC-2' }),
  },
  {
    nombre: 'DELETE /triages/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.delete(ruta('/triages/9950999')),
  },

  // ─── service-records ─────────────────────────────────────────────────────
  {
    nombre: 'GET /service-records',
    permisos: [PERMISSIONS.services.read],
    llamar: (s) => s.get(ruta('/service-records')),
  },
  {
    nombre: 'POST /service-records',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) =>
      s.post(ruta('/service-records'), {
        id: 9_950_301,
        admissionId: 9_999_999,
        code: 'ZE2ERBAC01',
        procedureName: 'Procedimiento RBAC',
        quantity: 1,
        providedAt: '2026-06-01T08:00:00-05:00',
        areaCode: 'A1',
        area: 'AREA RBAC',
        specialty: 'ESP RBAC',
      }),
  },
  {
    nombre: 'GET /service-records/:id',
    permisos: [PERMISSIONS.services.read],
    llamar: (s) => s.get(ruta('/service-records/9950999')),
  },
  {
    nombre: 'PATCH /service-records/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.patch(ruta('/service-records/9950999'), { quantity: 2 }),
  },
  {
    nombre: 'DELETE /service-records/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.delete(ruta('/service-records/9950999')),
  },

  // ─── procedures ──────────────────────────────────────────────────────────
  { nombre: 'GET /procedures', permisos: [PERMISSIONS.services.read], llamar: (s) => s.get(ruta('/procedures')) },
  {
    nombre: 'POST /procedures',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.post(ruta('/procedures'), { code: 'ZE2ERBAC02', name: 'Procedimiento RBAC 2' }),
  },
  {
    nombre: 'GET /procedures/:code',
    permisos: [PERMISSIONS.services.read],
    llamar: (s) => s.get(ruta('/procedures/ZNOEXISTE1')),
  },
  {
    nombre: 'PATCH /procedures/:code',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.patch(ruta('/procedures/ZNOEXISTE1'), { name: 'x' }),
  },
  {
    nombre: 'DELETE /procedures/:code',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.delete(ruta('/procedures/ZNOEXISTE1')),
  },

  // ─── surgery-schedules ───────────────────────────────────────────────────
  {
    nombre: 'GET /surgery-schedules',
    permisos: [PERMISSIONS.surgeries.read],
    llamar: (s) => s.get(ruta('/surgery-schedules')),
  },
  {
    nombre: 'POST /surgery-schedules',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) =>
      s.post(ruta('/surgery-schedules'), {
        scheduleNumber: 'ZE2ERBAC-01',
        patientId: 9_950_401,
        // Entero sintetico, NO null: SurgerySchedule no tiene FK real hacia
        // Admission (schema.prisma), asi que cualquier entero vale sin violar
        // nada. Con `null` el indice unico compuesto NO deduplica (Postgres no
        // iguala dos NULL, documentado en schema.prisma): SUPER_ADMIN Y ADMIN
        // insertarian cada uno su propia fila en vez de que el segundo choque
        // con 409, dejando basura doble que ensucia otras specs E2E que
        // cotejan cifras exactas.
        admissionId: 9_950_402,
        procedureCode: 'ZE2ERBAC03',
      }),
  },
  {
    nombre: 'GET /surgery-schedules/:id',
    permisos: [PERMISSIONS.surgeries.read],
    llamar: (s) => s.get(ruta('/surgery-schedules/9950999')),
  },
  {
    nombre: 'PATCH /surgery-schedules/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.patch(ruta('/surgery-schedules/9950999'), { procedureCode: 'ZE2ERBAC04' }),
  },
  {
    nombre: 'DELETE /surgery-schedules/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.delete(ruta('/surgery-schedules/9950999')),
  },

  // ─── medications: detalle, catalogo y dispensaciones ────────────────────
  {
    nombre: 'GET /medications/:code',
    permisos: [PERMISSIONS.medications.read],
    llamar: (s) => s.get(ruta('/medications/ZNOEXISTE1')),
  },
  {
    nombre: 'POST /medications',
    permisos: [PERMISSIONS.medications.manage],
    llamar: (s) => s.post(ruta('/medications'), { code: 'ZE2ERBAC05', name: 'Medicamento RBAC', kind: 'medicamento' }),
  },
  {
    nombre: 'PATCH /medications/:code',
    permisos: [PERMISSIONS.medications.manage],
    llamar: (s) => s.patch(ruta('/medications/ZNOEXISTE1'), { name: 'x' }),
  },
  {
    nombre: 'DELETE /medications/:code',
    permisos: [PERMISSIONS.medications.manage],
    llamar: (s) => s.delete(ruta('/medications/ZNOEXISTE1')),
  },
  {
    nombre: 'GET /medications/stock',
    permisos: [PERMISSIONS.medications.read],
    llamar: (s) => s.get(ruta('/medications/stock')),
  },
  {
    nombre: 'DELETE /medications/:code/stock',
    permisos: [PERMISSIONS.medications.manage],
    llamar: (s) => s.delete(ruta('/medications/ZNOEXISTE1/stock')),
  },
  {
    nombre: 'GET /medications/dispenses',
    permisos: [PERMISSIONS.medications.read],
    llamar: (s) => s.get(ruta('/medications/dispenses')),
  },
  {
    nombre: 'POST /medications/dispenses',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) =>
      s.post(ruta('/medications/dispenses'), {
        id: 9_950_501,
        admissionId: 9_999_999,
        code: 'ZE2ERBAC06',
        quantity: 1,
        dispensedAt: '2026-06-01T08:00:00-05:00',
        area: 'AREA RBAC',
        specialty: 'ESP RBAC',
      }),
  },
  {
    nombre: 'GET /medications/dispenses/:id',
    permisos: [PERMISSIONS.medications.read],
    llamar: (s) => s.get(ruta('/medications/dispenses/9950999')),
  },
  {
    nombre: 'PATCH /medications/dispenses/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.patch(ruta('/medications/dispenses/9950999'), { quantity: 2 }),
  },
  {
    nombre: 'DELETE /medications/dispenses/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (s) => s.delete(ruta('/medications/dispenses/9950999')),
  },

  // ─── alerts: reglas, manual y borrado ────────────────────────────────────
  { nombre: 'GET /alerts/rules', permisos: [PERMISSIONS.alerts.read], llamar: (s) => s.get(ruta('/alerts/rules')) },
  {
    nombre: 'GET /alerts/rules/:type',
    permisos: [PERMISSIONS.alerts.read],
    llamar: (s) => s.get(ruta('/alerts/rules/LOW_STOCK')),
  },
  {
    nombre: 'PATCH /alerts/rules/:type',
    permisos: [PERMISSIONS.system.manage],
    llamar: (s) => s.patch(ruta('/alerts/rules/LOW_STOCK'), { enabled: true }),
  },
  {
    nombre: 'POST /alerts (manual)',
    permisos: [PERMISSIONS.alerts.manage],
    permisosAlguno: [PERMISSIONS.surgeries.read],
    llamar: (s) =>
      s.post(ruta('/alerts'), {
        type: 'SURGERY_CANCELLATIONS',
        severity: 'WARNING',
        scope: 'surgery',
        message: 'Alerta manual de prueba RBAC E2E',
      }),
  },
  {
    nombre: 'DELETE /alerts/:id',
    permisos: [PERMISSIONS.alerts.manage],
    llamar: (s) => s.delete(ruta(`/alerts/${idInexistente}`)),
  },

  // ─── audit ───────────────────────────────────────────────────────────────
  {
    nombre: 'GET /audit/:id',
    permisos: [PERMISSIONS.audit.read],
    llamar: (s) => s.get(ruta(`/audit/${idInexistente}`)),
  },

  // ─── imports ─────────────────────────────────────────────────────────────
  { nombre: 'GET /imports', permisos: [PERMISSIONS.data.import], llamar: (s) => s.get(ruta('/imports')) },
  {
    nombre: 'GET /imports/:id',
    permisos: [PERMISSIONS.data.import],
    llamar: (s) => s.get(ruta(`/imports/${idInexistente}`)),
  },
  {
    nombre: 'DELETE /imports/:id',
    permisos: [PERMISSIONS.data.import],
    llamar: (s) => s.delete(ruta(`/imports/${idInexistente}`)),
  },
  {
    nombre: 'GET /imports/templates/:table',
    permisos: [PERMISSIONS.data.import],
    llamar: (s) => s.get(ruta('/imports/templates/patients')),
  },
  {
    nombre: 'POST /imports/:table',
    permisos: [PERMISSIONS.data.import],
    // Mismo patron que `subirCsv` en `imports.e2e.test.ts`: autenticado con el
    // Bearer de la sesion (no cookie), asi que no hace falta `Origin` (la
    // guarda de CSRF solo exige Origin cuando hay cookie de sesion, CLAUDE.md §15).
    llamar: async (s) => {
      const r = await s.raw(ruta('/imports/patients'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'text/csv' },
        body: 'TipoDocumento|IdPaciente|NombrePaciente|FechaNacimiento|Sexo|Asegurador|Regimen|Departamento|Municipio|Zona\n',
      });
      const texto = await r.text();
      return { status: r.status, headers: r.headers, body: texto ? (JSON.parse(texto) as unknown) : null };
    },
  },
];

/** Permisos efectivos de un rol de sistema, resolviendo el comodin. */
function tieneTodos(permisos: ReadonlySet<string>, requeridos: string[]): boolean {
  return permisos.has(WILDCARD_PERMISSION) || requeridos.every((p) => permisos.has(p));
}

function tieneAlguno(permisos: ReadonlySet<string>, alguno: string[]): boolean {
  return permisos.has(WILDCARD_PERMISSION) || alguno.some((p) => permisos.has(p));
}

function esPermitido(permisos: ReadonlySet<string>, endpoint: EndpointCaso): boolean {
  if (!tieneTodos(permisos, endpoint.permisos)) return false;
  if (!endpoint.permisosAlguno || endpoint.permisosAlguno.length === 0) return true;
  return tieneAlguno(permisos, endpoint.permisosAlguno);
}

describe(`Matriz RBAC E2E · 7 roles x ${ENDPOINTS.length} endpoints`, () => {
  afterAll(async () => {
    // Los roles con `data.manage`/`medications.manage` (ADMIN, SUPER_ADMIN) SI
    // llegan a crear filas de verdad al pasar por esta matriz (POST exitoso,
    // no bloqueado por el permiso): sin este cleanup, la siguiente spec E2E
    // que coteje cifras EXACTAS contra `hospital_e2e` (p.ej.
    // cirugias.e2e.test.ts, alertas.e2e.test.ts) veria de mas.
    const prisma = prismaE2E();
    const sintetico = { OR: [{ id: { gte: 9_000_000 } }, { admissionId: { gte: 9_000_000 } }, { code: { startsWith: 'ZE2E' } }] };
    await prisma.serviceRecord.deleteMany({ where: sintetico });
    await prisma.medicationDispense.deleteMany({ where: sintetico });
    await prisma.surgerySchedule.deleteMany({
      where: {
        OR: [
          { id: { gte: 9_000_000 } },
          { admissionId: { gte: 9_000_000 } },
          { patientId: { gte: 9_000_000 } },
          { procedureCode: { startsWith: 'ZE2E' } },
          { scheduleNumber: { startsWith: 'ZE2E' } },
        ],
      },
    });
    await prisma.admission.deleteMany({ where: { OR: [{ id: { gte: 9_000_000 } }, { patientId: { gte: 9_000_000 } }] } });
    await prisma.triage.deleteMany({ where: { OR: [{ id: { gte: 9_000_000 } }, { patientId: { gte: 9_000_000 } }] } });
    await prisma.patient.deleteMany({ where: { id: { gte: 9_000_000 } } });
    await prisma.procedure.deleteMany({ where: { code: { startsWith: 'ZE2E' } } });
    await prisma.medication.deleteMany({ where: { code: { startsWith: 'ZE2E' } } });
    await prisma.medicationStock.deleteMany({ where: { code: { startsWith: 'ZE2E' } } });
    await prisma.alert.deleteMany({ where: { source: 'manual' } });
    await prisma.importJob.deleteMany();
  });

  describe('sin sesion -> 401 en todos', () => {
    for (const endpoint of ENDPOINTS) {
      it(`${endpoint.nombre} -> 401`, async () => {
        const sesion = new Sesion(BASE);
        const r = await endpoint.llamar(sesion);
        expect(r.status).toBe(401);
      });
    }
  });

  for (const [nombreRol, rol] of Object.entries(SYSTEM_ROLES)) {
    describe(nombreRol, () => {
      let sesion: Sesion;

      beforeAll(async () => {
        sesion = await comoRol(BASE, nombreRol);
      });

      const permisos = new Set<string>(rol.permissions);

      for (const endpoint of ENDPOINTS) {
        const permitido = esPermitido(permisos, endpoint);

        it(`${endpoint.nombre} -> ${permitido ? 'permitido' : '403'}`, async () => {
          const r = await endpoint.llamar(sesion);
          if (permitido) {
            expect(r.status).not.toBe(401);
            expect(r.status).not.toBe(403);
          } else {
            expect(r.status).toBe(403);
          }
        });
      }
    });
  }
});
