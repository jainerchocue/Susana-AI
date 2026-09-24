import { randomUUID } from 'node:crypto';
import { describe, expect, inject, it, beforeAll } from 'vitest';
import { env } from '../../src/config/env';
import { PERMISSIONS, SYSTEM_ROLES, WILDCARD_PERMISSION } from '../../src/core/rbac/permissions';
import { comoRol, Sesion } from './cliente';
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
];

/** Permisos efectivos de un rol de sistema, resolviendo el comodin. */
function tieneTodos(permisos: ReadonlySet<string>, requeridos: string[]): boolean {
  return permisos.has(WILDCARD_PERMISSION) || requeridos.every((p) => permisos.has(p));
}

describe(`Matriz RBAC E2E · 7 roles x ${ENDPOINTS.length} endpoints`, () => {
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
        const permitido = tieneTodos(permisos, endpoint.permisos);

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
