import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Test } from 'supertest';
import { api, cargarFixturesHis, crearUsuarioConRol, getApp, limpiar, prisma } from '../helpers';
import { PERMISSIONS, SYSTEM_ROLES, WILDCARD_PERMISSION } from '../../src/core/rbac/permissions';

/**
 * Matriz RBAC: los 7 roles de sistema contra un endpoint representativo de
 * cada modulo. Lo esperado NO se escribe a mano: se calcula desde
 * `SYSTEM_ROLES` (la misma fuente que siembra la BD), asi que si el catalogo
 * cambia sin avisar aqui, este test es el primero en fallar.
 *
 * "permitido" = la peticion pasa `authenticate` y `requirePermissions` (no
 * responde 401 ni 403); lo que el controlador haga despues (200, 404, 422...)
 * no es lo que se prueba aqui, eso ya lo cubren los tests de cada modulo.
 */

const idInexistente = randomUUID();

interface EndpointCaso {
  nombre: string;
  /**
   * Permiso(s) que la peticion COMPLETA exige para no acabar en 401/403 (modo
   * "todos"). La mayoria de rutas necesitan solo el que pone
   * `requirePermissions` en la ruta.
   */
  permisos: string[];
  /**
   * Solo para `/assistant/query`: ademas de `permisos`, hace falta AL MENOS
   * UNO de estos. `datasetsPara()` filtra el catalogo del asistente por el
   * permiso de cada dataset (`alerts:read`, y desde T10 tambien
   * `services:read`/`medications:read`/`surgeries:read` para los datasets
   * HIS); sin ninguno de los dos, `datasetsPara()` no ve ningun dataset y
   * `assistant.service.ts` responde 403 INSUFFICIENT_PERMISSIONS aunque
   * `requirePermissions(assistant:use)` ya haya dejado pasar la peticion. No
   * es una puerta duplicada en el servicio: es la interseccion
   * catalogo/permisos que describe `docs/rbac.md`.
   */
  permisosAlguno?: string[];
  llamar: (token?: string) => Test;
}

function conToken(peticion: Test, token?: string): Test {
  return token ? peticion.set('Authorization', `Bearer ${token}`) : peticion;
}

const ENDPOINTS: EndpointCaso[] = [
  {
    nombre: 'GET /users',
    permisos: [PERMISSIONS.users.read],
    llamar: (token) => conToken(api().get('/api/v1/users'), token),
  },
  {
    nombre: 'POST /users',
    permisos: [PERMISSIONS.users.create],
    llamar: (token) => conToken(api().post('/api/v1/users'), token).send({}),
  },
  {
    nombre: 'GET /roles',
    permisos: [PERMISSIONS.roles.read],
    llamar: (token) => conToken(api().get('/api/v1/roles'), token),
  },
  {
    nombre: 'GET /permissions',
    permisos: [PERMISSIONS.permissions.read],
    llamar: (token) => conToken(api().get('/api/v1/permissions'), token),
  },
  {
    nombre: 'GET /audit',
    permisos: [PERMISSIONS.audit.read],
    llamar: (token) => conToken(api().get('/api/v1/audit'), token),
  },
  {
    nombre: 'GET /alerts',
    permisos: [PERMISSIONS.alerts.read],
    llamar: (token) => conToken(api().get('/api/v1/alerts'), token),
  },
  {
    nombre: 'PATCH /alerts/:id',
    permisos: [PERMISSIONS.alerts.manage],
    llamar: (token) =>
      conToken(api().patch(`/api/v1/alerts/${idInexistente}`), token).send({ status: 'RESOLVED' }),
  },
  {
    nombre: 'POST /assistant/query',
    permisos: [PERMISSIONS.assistant.use],
    // Cualquier permiso que destape al menos un dataset del catalogo basta
    // (T10 añadio datasets HIS ademas de "alerts"): ver el comentario de
    // `permisosAlguno` en `EndpointCaso`.
    permisosAlguno: [
      PERMISSIONS.alerts.read,
      PERMISSIONS.services.read,
      PERMISSIONS.medications.read,
      PERMISSIONS.surgeries.read,
    ],
    llamar: (token) =>
      conToken(api().post('/api/v1/assistant/query'), token).send({
        question: 'Pregunta de prueba para la matriz RBAC',
      }),
  },

  // ─── dashboard (T8) ────────────────────────────────────────────────────────
  {
    nombre: 'GET /dashboard/summary',
    permisos: [PERMISSIONS.dashboard.read],
    llamar: (token) => conToken(api().get('/api/v1/dashboard/summary'), token),
  },
  {
    nombre: 'GET /dashboard/occupancy',
    permisos: [PERMISSIONS.dashboard.read, PERMISSIONS.services.read],
    llamar: (token) => conToken(api().get('/api/v1/dashboard/occupancy'), token),
  },
  {
    nombre: 'GET /dashboard/wait-times',
    permisos: [PERMISSIONS.dashboard.read, PERMISSIONS.services.read],
    llamar: (token) => conToken(api().get('/api/v1/dashboard/wait-times'), token),
  },
  {
    nombre: 'GET /dashboard/demand',
    permisos: [PERMISSIONS.dashboard.read, PERMISSIONS.services.read],
    llamar: (token) => conToken(api().get('/api/v1/dashboard/demand'), token),
  },

  // ─── analytics + sus exports (T8/T9) ───────────────────────────────────────
  {
    nombre: 'GET /analytics/services',
    permisos: [PERMISSIONS.analytics.read, PERMISSIONS.services.read],
    llamar: (token) => conToken(api().get('/api/v1/analytics/services'), token),
  },
  {
    nombre: 'GET /analytics/triage',
    permisos: [PERMISSIONS.analytics.read, PERMISSIONS.services.read],
    llamar: (token) => conToken(api().get('/api/v1/analytics/triage'), token),
  },
  {
    nombre: 'GET /analytics/surgeries',
    permisos: [PERMISSIONS.analytics.read, PERMISSIONS.surgeries.read],
    llamar: (token) => conToken(api().get('/api/v1/analytics/surgeries'), token),
  },
  {
    nombre: 'GET /analytics/services/export',
    permisos: [PERMISSIONS.analytics.export, PERMISSIONS.analytics.read, PERMISSIONS.services.read],
    llamar: (token) => conToken(api().get('/api/v1/analytics/services/export'), token),
  },
  {
    nombre: 'GET /analytics/triage/export',
    permisos: [PERMISSIONS.analytics.export, PERMISSIONS.analytics.read, PERMISSIONS.services.read],
    llamar: (token) => conToken(api().get('/api/v1/analytics/triage/export'), token),
  },
  {
    nombre: 'GET /analytics/surgeries/export',
    permisos: [PERMISSIONS.analytics.export, PERMISSIONS.analytics.read, PERMISSIONS.surgeries.read],
    llamar: (token) => conToken(api().get('/api/v1/analytics/surgeries/export'), token),
  },

  // ─── medications (T9) ──────────────────────────────────────────────────────
  {
    nombre: 'GET /medications',
    permisos: [PERMISSIONS.medications.read],
    llamar: (token) => conToken(api().get('/api/v1/medications'), token),
  },
  {
    nombre: 'GET /medications/critical',
    permisos: [PERMISSIONS.medications.read],
    llamar: (token) => conToken(api().get('/api/v1/medications/critical'), token),
  },
  {
    nombre: 'GET /medications/consumption',
    permisos: [PERMISSIONS.medications.read],
    llamar: (token) => conToken(api().get('/api/v1/medications/consumption'), token),
  },
  {
    nombre: 'PUT /medications/:code/stock',
    permisos: [PERMISSIONS.medications.manage],
    llamar: (token) =>
      conToken(api().put('/api/v1/medications/RBACTEST/stock'), token).send({ quantity: 10 }),
  },

  // ─── alertas: evaluacion manual del motor (T11) ────────────────────────────
  {
    nombre: 'POST /alerts/evaluate',
    permisos: [PERMISSIONS.alerts.manage],
    llamar: (token) => conToken(api().post('/api/v1/alerts/evaluate'), token),
  },

  // ─── TC6: rutas nuevas de C-1 (CRUD HIS, imports, alertas/reglas, audit) ────
  // Ids sinteticos ZRBAC*/9.900.xxx (CLAUDE.md/C0: ">= 9.000.000" y prefijo
  // reservado): nunca chocan con los fixtures de `cargarFixturesHis()`.
  // Cuerpos siempre validos: con `validate` antes de `requirePermissions` (el
  // orden canonico, CLAUDE.md §5) un cuerpo invalido daria 422 en vez de 403 y
  // enmascararia el propio chequeo de permisos que este test quiere probar.

  // ─── patients (TC2) ─────────────────────────────────────────────────────────
  {
    nombre: 'GET /patients',
    permisos: [PERMISSIONS.patients.read],
    llamar: (token) => conToken(api().get('/api/v1/patients'), token),
  },
  {
    nombre: 'POST /patients',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) =>
      conToken(api().post('/api/v1/patients'), token).send({
        id: 9_900_001,
        documentType: 'CC',
        birthDate: '2000-01-01',
        sex: 'Masculino',
        insurer: 'EPS RBAC TEST',
        regime: 'Contributivo',
        department: 'RBAC',
        municipality: 'RBAC',
        zone: 'Urbana',
      }),
  },
  {
    nombre: 'GET /patients/:id',
    permisos: [PERMISSIONS.patients.read],
    llamar: (token) => conToken(api().get('/api/v1/patients/9900999'), token),
  },
  {
    nombre: 'PATCH /patients/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) => conToken(api().patch('/api/v1/patients/9900999'), token).send({ zone: 'Rural' }),
  },
  {
    nombre: 'DELETE /patients/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) => conToken(api().delete('/api/v1/patients/9900999'), token),
  },

  // ─── admissions (TC2) ───────────────────────────────────────────────────────
  {
    nombre: 'GET /admissions',
    permisos: [PERMISSIONS.services.read],
    llamar: (token) => conToken(api().get('/api/v1/admissions'), token),
  },
  {
    nombre: 'POST /admissions',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) =>
      conToken(api().post('/api/v1/admissions'), token).send({
        id: 9_900_101,
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
    llamar: (token) => conToken(api().get('/api/v1/admissions/9900999'), token),
  },
  {
    nombre: 'PATCH /admissions/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) => conToken(api().patch('/api/v1/admissions/9900999'), token).send({ subunit: 'RBAC-2' }),
  },
  {
    nombre: 'DELETE /admissions/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) => conToken(api().delete('/api/v1/admissions/9900999'), token),
  },
  {
    nombre: 'PUT /admissions/:id/first-care',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) =>
      conToken(api().put('/api/v1/admissions/9900999/first-care'), token).send({
        firstCareAt: '2026-06-01T08:00:00-05:00',
      }),
  },
  {
    nombre: 'DELETE /admissions/:id/first-care',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) => conToken(api().delete('/api/v1/admissions/9900999/first-care'), token),
  },

  // ─── triages (TC2) ──────────────────────────────────────────────────────────
  {
    nombre: 'GET /triages',
    permisos: [PERMISSIONS.services.read],
    llamar: (token) => conToken(api().get('/api/v1/triages'), token),
  },
  {
    nombre: 'POST /triages',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) =>
      conToken(api().post('/api/v1/triages'), token).send({
        id: 9_900_201,
        triagedAt: '2026-06-01T08:00:00-05:00',
        code: 'RBAC1',
        classification: 'TRIAGE RBAC (VERDE)',
      }),
  },
  {
    nombre: 'GET /triages/:id',
    permisos: [PERMISSIONS.services.read],
    llamar: (token) => conToken(api().get('/api/v1/triages/9900999'), token),
  },
  {
    nombre: 'PATCH /triages/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) => conToken(api().patch('/api/v1/triages/9900999'), token).send({ classification: 'RBAC-2' }),
  },
  {
    nombre: 'DELETE /triages/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) => conToken(api().delete('/api/v1/triages/9900999'), token),
  },

  // ─── service-records (TC3) ──────────────────────────────────────────────────
  {
    nombre: 'GET /service-records',
    permisos: [PERMISSIONS.services.read],
    llamar: (token) => conToken(api().get('/api/v1/service-records'), token),
  },
  {
    nombre: 'POST /service-records',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) =>
      conToken(api().post('/api/v1/service-records'), token).send({
        id: 9_900_301,
        admissionId: 9_999_999,
        code: 'ZRBAC001',
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
    llamar: (token) => conToken(api().get('/api/v1/service-records/9900999'), token),
  },
  {
    nombre: 'PATCH /service-records/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) => conToken(api().patch('/api/v1/service-records/9900999'), token).send({ quantity: 2 }),
  },
  {
    nombre: 'DELETE /service-records/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) => conToken(api().delete('/api/v1/service-records/9900999'), token),
  },

  // ─── procedures (TC3) ────────────────────────────────────────────────────────
  {
    nombre: 'GET /procedures',
    permisos: [PERMISSIONS.services.read],
    llamar: (token) => conToken(api().get('/api/v1/procedures'), token),
  },
  {
    nombre: 'POST /procedures',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) =>
      conToken(api().post('/api/v1/procedures'), token).send({ code: 'ZRBAC002', name: 'Procedimiento RBAC 2' }),
  },
  {
    nombre: 'GET /procedures/:code',
    permisos: [PERMISSIONS.services.read],
    llamar: (token) => conToken(api().get('/api/v1/procedures/ZNOEXISTE1'), token),
  },
  {
    nombre: 'PATCH /procedures/:code',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) => conToken(api().patch('/api/v1/procedures/ZNOEXISTE1'), token).send({ name: 'x' }),
  },
  {
    nombre: 'DELETE /procedures/:code',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) => conToken(api().delete('/api/v1/procedures/ZNOEXISTE1'), token),
  },

  // ─── surgery-schedules (TC3) ────────────────────────────────────────────────
  {
    nombre: 'GET /surgery-schedules',
    permisos: [PERMISSIONS.surgeries.read],
    llamar: (token) => conToken(api().get('/api/v1/surgery-schedules'), token),
  },
  {
    nombre: 'POST /surgery-schedules',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) =>
      conToken(api().post('/api/v1/surgery-schedules'), token).send({
        scheduleNumber: 'ZRBAC-0001',
        patientId: 9_900_401,
        // Entero sintetico, no null: con null el indice unico compuesto NO
        // deduplica (Postgres no iguala dos NULL, schema.prisma), y SUPER_ADMIN
        // y ADMIN insertarian cada uno su propia fila en vez de que el segundo
        // choque con 409 (verificado en la matriz E2E, tests/e2e/rbac.e2e.test.ts).
        admissionId: 9_900_402,
        procedureCode: 'ZRBAC003',
      }),
  },
  {
    nombre: 'GET /surgery-schedules/:id',
    permisos: [PERMISSIONS.surgeries.read],
    llamar: (token) => conToken(api().get('/api/v1/surgery-schedules/9900999'), token),
  },
  {
    nombre: 'PATCH /surgery-schedules/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) =>
      conToken(api().patch('/api/v1/surgery-schedules/9900999'), token).send({ procedureCode: 'ZRBAC004' }),
  },
  {
    nombre: 'DELETE /surgery-schedules/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) => conToken(api().delete('/api/v1/surgery-schedules/9900999'), token),
  },

  // ─── medications: detalle, catalogo y dispensaciones (TC4) ─────────────────
  {
    nombre: 'GET /medications/:code',
    permisos: [PERMISSIONS.medications.read],
    llamar: (token) => conToken(api().get('/api/v1/medications/ZNOEXISTE1'), token),
  },
  {
    nombre: 'POST /medications',
    permisos: [PERMISSIONS.medications.manage],
    llamar: (token) =>
      conToken(api().post('/api/v1/medications'), token).send({
        code: 'ZRBAC005',
        name: 'Medicamento RBAC',
        kind: 'medicamento',
      }),
  },
  {
    nombre: 'PATCH /medications/:code',
    permisos: [PERMISSIONS.medications.manage],
    llamar: (token) => conToken(api().patch('/api/v1/medications/ZNOEXISTE1'), token).send({ name: 'x' }),
  },
  {
    nombre: 'DELETE /medications/:code',
    permisos: [PERMISSIONS.medications.manage],
    llamar: (token) => conToken(api().delete('/api/v1/medications/ZNOEXISTE1'), token),
  },
  {
    nombre: 'GET /medications/stock',
    permisos: [PERMISSIONS.medications.read],
    llamar: (token) => conToken(api().get('/api/v1/medications/stock'), token),
  },
  {
    nombre: 'DELETE /medications/:code/stock',
    permisos: [PERMISSIONS.medications.manage],
    llamar: (token) => conToken(api().delete('/api/v1/medications/ZNOEXISTE1/stock'), token),
  },
  {
    nombre: 'GET /medications/dispenses',
    permisos: [PERMISSIONS.medications.read],
    llamar: (token) => conToken(api().get('/api/v1/medications/dispenses'), token),
  },
  {
    nombre: 'POST /medications/dispenses',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) =>
      conToken(api().post('/api/v1/medications/dispenses'), token).send({
        id: 9_900_501,
        admissionId: 9_999_999,
        code: 'ZRBAC006',
        quantity: 1,
        dispensedAt: '2026-06-01T08:00:00-05:00',
        area: 'AREA RBAC',
        specialty: 'ESP RBAC',
      }),
  },
  {
    nombre: 'GET /medications/dispenses/:id',
    permisos: [PERMISSIONS.medications.read],
    llamar: (token) => conToken(api().get('/api/v1/medications/dispenses/9900999'), token),
  },
  {
    nombre: 'PATCH /medications/dispenses/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) => conToken(api().patch('/api/v1/medications/dispenses/9900999'), token).send({ quantity: 2 }),
  },
  {
    nombre: 'DELETE /medications/dispenses/:id',
    permisos: [PERMISSIONS.data.manage],
    llamar: (token) => conToken(api().delete('/api/v1/medications/dispenses/9900999'), token),
  },

  // ─── alerts: reglas, manual y borrado (TC5) ─────────────────────────────────
  {
    nombre: 'GET /alerts/rules',
    permisos: [PERMISSIONS.alerts.read],
    llamar: (token) => conToken(api().get('/api/v1/alerts/rules'), token),
  },
  {
    nombre: 'GET /alerts/rules/:type',
    permisos: [PERMISSIONS.alerts.read],
    llamar: (token) => conToken(api().get('/api/v1/alerts/rules/LOW_STOCK'), token),
  },
  {
    nombre: 'PATCH /alerts/rules/:type',
    permisos: [PERMISSIONS.system.manage],
    llamar: (token) => conToken(api().patch('/api/v1/alerts/rules/LOW_STOCK'), token).send({ enabled: true }),
  },
  {
    nombre: 'POST /alerts (manual)',
    permisos: [PERMISSIONS.alerts.manage],
    // El servicio ADEMAS exige `alcancesPorPermiso` sobre `scope` (C0: "solo se
    // pueden crear en un scope visible para quien la crea"): con scope
    // 'surgery' hace falta TAMBIEN surgeries:read (ALERT_SCOPE_PERMISSION,
    // alerts.constants.ts). Mismo mecanismo que `permisosAlguno` en
    // /assistant/query, no una puerta duplicada (docs/rbac.md).
    permisosAlguno: [PERMISSIONS.surgeries.read],
    llamar: (token) =>
      conToken(api().post('/api/v1/alerts'), token).send({
        type: 'SURGERY_CANCELLATIONS',
        severity: 'WARNING',
        scope: 'surgery',
        message: 'Alerta manual de prueba RBAC',
      }),
  },
  {
    nombre: 'DELETE /alerts/:id',
    permisos: [PERMISSIONS.alerts.manage],
    llamar: (token) => conToken(api().delete(`/api/v1/alerts/${idInexistente}`), token),
  },

  // ─── audit (TC5) ────────────────────────────────────────────────────────────
  {
    nombre: 'GET /audit/:id',
    permisos: [PERMISSIONS.audit.read],
    llamar: (token) => conToken(api().get(`/api/v1/audit/${idInexistente}`), token),
  },

  // ─── imports (TC1) ──────────────────────────────────────────────────────────
  {
    nombre: 'GET /imports',
    permisos: [PERMISSIONS.data.import],
    llamar: (token) => conToken(api().get('/api/v1/imports'), token),
  },
  {
    nombre: 'GET /imports/:id',
    permisos: [PERMISSIONS.data.import],
    llamar: (token) => conToken(api().get(`/api/v1/imports/${idInexistente}`), token),
  },
  {
    nombre: 'DELETE /imports/:id',
    permisos: [PERMISSIONS.data.import],
    llamar: (token) => conToken(api().delete(`/api/v1/imports/${idInexistente}`), token),
  },
  {
    nombre: 'GET /imports/templates/:table',
    permisos: [PERMISSIONS.data.import],
    llamar: (token) => conToken(api().get('/api/v1/imports/templates/patients'), token),
  },
  {
    nombre: 'POST /imports/:table',
    permisos: [PERMISSIONS.data.import],
    llamar: (token) =>
      conToken(api().post('/api/v1/imports/patients'), token)
        .set('Content-Type', 'text/csv')
        .send(
          'TipoDocumento|IdPaciente|NombrePaciente|FechaNacimiento|Sexo|Asegurador|Regimen|Departamento|Municipio|Zona\n',
        ),
  },
];

/** Permisos efectivos de un rol de sistema, resolviendo el comodin. */
function permisosEfectivos(rol: { permissions: readonly string[] }): Set<string> {
  return new Set(rol.permissions);
}

function tieneTodos(permisos: Set<string>, requeridos: string[]): boolean {
  return permisos.has(WILDCARD_PERMISSION) || requeridos.every((p) => permisos.has(p));
}

function tieneAlguno(permisos: Set<string>, alguno: string[]): boolean {
  return permisos.has(WILDCARD_PERMISSION) || alguno.some((p) => permisos.has(p));
}

function esPermitido(permisos: Set<string>, endpoint: EndpointCaso): boolean {
  if (!tieneTodos(permisos, endpoint.permisos)) return false;
  if (!endpoint.permisosAlguno || endpoint.permisosAlguno.length === 0) return true;
  return tieneAlguno(permisos, endpoint.permisosAlguno);
}

describe(`Matriz RBAC · 7 roles x ${ENDPOINTS.length} endpoints`, () => {
  beforeAll(async () => {
    await getApp();
    await limpiar();
    // Las rutas de dashboard/analytics/medications/surgeries y la evaluacion
    // de alertas necesitan datos HIS: sin fixtures, un rol "permitido" pasaria
    // el chequeo de permisos y aun asi veria 503 (fechaReferencia() sin datos),
    // no el 200 limpio que confirma que la puerta es la correcta.
    await cargarFixturesHis();
  });

  afterAll(async () => {
    // Los roles con `data.manage`/`medications.manage` (ADMIN, SUPER_ADMIN)
    // SI llegan a crear filas de verdad al pasar la matriz (id/scheduleNumber
    // no colisiona con un fixture -> 201, no 409): se limpian aqui para que la
    // siguiente suite que comparta `hospital_test` no las herede.
    const sinteticoServicioOMedicamento = {
      OR: [{ id: { gte: 9_000_000 } }, { admissionId: { gte: 9_000_000 } }, { code: { startsWith: 'ZRBAC' } }],
    };
    await prisma.serviceRecord.deleteMany({ where: sinteticoServicioOMedicamento });
    await prisma.medicationDispense.deleteMany({ where: sinteticoServicioOMedicamento });
    await prisma.surgerySchedule.deleteMany({
      where: {
        OR: [
          { id: { gte: 9_000_000 } },
          { admissionId: { gte: 9_000_000 } },
          { patientId: { gte: 9_000_000 } },
          { procedureCode: { startsWith: 'ZRBAC' } },
          { scheduleNumber: { startsWith: 'ZRBAC' } },
        ],
      },
    });
    await prisma.admission.deleteMany({ where: { OR: [{ id: { gte: 9_000_000 } }, { patientId: { gte: 9_000_000 } }] } });
    await prisma.triage.deleteMany({ where: { OR: [{ id: { gte: 9_000_000 } }, { patientId: { gte: 9_000_000 } }] } });
    await prisma.patient.deleteMany({ where: { id: { gte: 9_000_000 } } });
    await prisma.procedure.deleteMany({ where: { code: { startsWith: 'ZRBAC' } } });
    await prisma.medication.deleteMany({ where: { code: { startsWith: 'ZRBAC' } } });
    await prisma.medicationStock.deleteMany({ where: { code: { startsWith: 'ZRBAC' } } });
    await prisma.alert.deleteMany({ where: { source: 'manual' } });
    await prisma.importJob.deleteMany();

    await limpiar();
    await prisma.$disconnect();
  });

  describe('sin sesion', () => {
    for (const endpoint of ENDPOINTS) {
      it(`${endpoint.nombre} -> 401`, async () => {
        const res = await endpoint.llamar();
        expect(res.status).toBe(401);
      });
    }
  });

  for (const [nombreRol, rol] of Object.entries(SYSTEM_ROLES)) {
    describe(nombreRol, () => {
      let token: string;

      beforeAll(async () => {
        const usuario = await crearUsuarioConRol(nombreRol);
        token = usuario.token;
      });

      const permisos = permisosEfectivos(rol);

      for (const endpoint of ENDPOINTS) {
        const permitido = esPermitido(permisos, endpoint);

        it(`${endpoint.nombre} -> ${permitido ? 'permitido' : '403'}`, async () => {
          const res = await endpoint.llamar(token);

          if (permitido) {
            expect(res.status).not.toBe(401);
            expect(res.status).not.toBe(403);
          } else {
            expect(res.status).toBe(403);
          }
        });
      }
    });
  }
});
