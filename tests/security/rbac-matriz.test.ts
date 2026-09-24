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
