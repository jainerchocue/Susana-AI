import { beforeAll, describe, expect, inject, it } from 'vitest';
import { env } from '../../src/config/env';
import {
  PERMISSIONS,
  PERMISSION_LIST,
  SYSTEM_ROLES,
  WILDCARD_PERMISSION,
} from '../../src/core/rbac/permissions';
import { comoRol, credenciales, emailUnico, prismaE2E, Sesion } from './cliente';
import type { Respuesta } from './cliente';

/**
 * T14 (E2, BD `hospital_e2e_b`, puerto 3220): usuarios, roles, permisos y
 * auditoria contra el servidor real (E0). Cada cifra se coteja con una
 * consulta propia contra la BD E2E (prismaE2E()), nunca importando servicios
 * de `src/`. Cada usuario/rol que este archivo crea lleva un marcador
 * aleatorio en el nombre para no confundirse con lo que dejan otros tests de
 * este mismo archivo o corridas anteriores (la limpieza del global-setup solo
 * corre entre invocaciones de `npm run test:e2e`, no entre describes).
 */

const BASE = inject('e2eUrl');
const PREFIJO = env.API_PREFIX;

// Contraseña fija que cumple PASSWORD_POLICY (12+, mayus/minus/digito) y no
// contiene el local-part de `emailUnico()` (createUserSchema lo rechazaria).
const PASSWORD_E2E = 'HospitalIntel2026!Segura';

function sufijo(): string {
  return Math.random().toString(36).slice(2, 10);
}

const TAG = `e2e-ur-${sufijo()}`;

// ─── Helpers de narrowing (CLAUDE.md §11: sin `any`, `unknown` + estrechamiento) ──

function comoRegistro(valor: unknown): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null) {
    throw new Error(`Se esperaba un objeto JSON; se recibio: ${JSON.stringify(valor)}`);
  }
  return valor as Record<string, unknown>;
}
function comoArreglo(valor: unknown): unknown[] {
  if (!Array.isArray(valor)) throw new Error(`Se esperaba un arreglo; se recibio: ${JSON.stringify(valor)}`);
  return valor;
}
function comoTexto(valor: unknown): string {
  if (typeof valor !== 'string') throw new Error(`Se esperaba texto; se recibio: ${JSON.stringify(valor)}`);
  return valor;
}
function comoNumero(valor: unknown): number {
  if (typeof valor !== 'number') throw new Error(`Se esperaba un numero; se recibio: ${JSON.stringify(valor)}`);
  return valor;
}
function comoBooleano(valor: unknown): boolean {
  if (typeof valor !== 'boolean') throw new Error(`Se esperaba boolean; se recibio: ${JSON.stringify(valor)}`);
  return valor;
}
/** El `data` de una respuesta exitosa, como objeto. */
function dato(r: Respuesta): Record<string, unknown> {
  return comoRegistro(comoRegistro(r.body).data);
}
/** El `data` de una respuesta paginada, como arreglo de objetos. */
function lista(r: Respuesta): Record<string, unknown>[] {
  return comoArreglo(comoRegistro(r.body).data).map(comoRegistro);
}
function paginacion(r: Respuesta): Record<string, unknown> {
  return comoRegistro(comoRegistro(r.body).pagination);
}
function idDe(r: Respuesta): string {
  return comoTexto(dato(r).id);
}
/** Ninguna respuesta de este dominio debe filtrar password ni hash (CLAUDE.md §7). */
function sinCredenciales(cuerpo: unknown): void {
  const texto = JSON.stringify(cuerpo).toLowerCase();
  expect(texto.includes('"password"')).toBe(false);
  expect(texto.includes('hash')).toBe(false);
}

describe('usuarios, roles, permisos y auditoria (T14)', () => {
  let superadmin: Sesion;
  let admin: Sesion;

  beforeAll(async () => {
    superadmin = new Sesion(BASE);
    const login = await superadmin.login(credenciales.superadmin.email, credenciales.superadmin.password);
    if (login.status !== 200) throw new Error(`No se pudo iniciar sesion como superadmin (${login.status}).`);
    admin = await comoRol(BASE, SYSTEM_ROLES.ADMIN.name);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Creacion de usuarios
  // ─────────────────────────────────────────────────────────────────────────
  describe('creacion de usuarios', () => {
    it('el superadmin crea un usuario sin roles -> CONSULTA por defecto', async () => {
      const email = emailUnico();
      const r = await superadmin.post(`${PREFIJO}/users`, {
        email,
        password: PASSWORD_E2E,
        name: `${TAG}-sin-roles`,
        roles: [],
      });
      expect(r.status).toBe(201);
      const creado = dato(r);
      expect(creado.email).toBe(email);
      expect(comoArreglo(creado.roles)).toEqual([SYSTEM_ROLES.CONSULTA.name]);
      sinCredenciales(r.body);
    });

    it('el superadmin crea un usuario CON roles -> exactamente esos roles (no queda el por defecto)', async () => {
      const email = emailUnico();
      const r = await superadmin.post(`${PREFIJO}/users`, {
        email,
        password: PASSWORD_E2E,
        name: `${TAG}-con-roles`,
        roles: [SYSTEM_ROLES.DIRECTOR.name],
      });
      expect(r.status).toBe(201);
      expect(comoArreglo(dato(r).roles)).toEqual([SYSTEM_ROLES.DIRECTOR.name]);
    });

    it('ADMIN (con todos los permisos del catalogo) tambien puede dar de alta usuarios', async () => {
      const email = emailUnico();
      const r = await admin.post(`${PREFIJO}/users`, {
        email,
        password: PASSWORD_E2E,
        name: `${TAG}-admin-alta`,
        roles: [SYSTEM_ROLES.FARMACIA.name],
      });
      expect(r.status).toBe(201);
      expect(comoArreglo(dato(r).roles)).toEqual([SYSTEM_ROLES.FARMACIA.name]);
    });

    it('el usuario recien creado puede iniciar sesion', async () => {
      const email = emailUnico();
      const alta = await superadmin.post(`${PREFIJO}/users`, {
        email,
        password: PASSWORD_E2E,
        name: `${TAG}-login`,
        roles: [],
      });
      expect(alta.status).toBe(201);

      const sesionNueva = new Sesion(BASE);
      const login = await sesionNueva.login(email, PASSWORD_E2E);
      expect(login.status).toBe(200);
    });

    it('ninguna respuesta de alta expone password ni hash', async () => {
      const email = emailUnico();
      const r = await superadmin.post(`${PREFIJO}/users`, {
        email,
        password: PASSWORD_E2E,
        name: `${TAG}-sin-creds`,
        roles: [],
      });
      sinCredenciales(r.body);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Listado: cursor, pagina, busqueda y filtros, cotejado con la BD
  // ─────────────────────────────────────────────────────────────────────────
  describe('listado', () => {
    const marcador = `${TAG}-pag-${sufijo()}`;
    let idSuspendido = '';
    let idDirector = '';

    beforeAll(async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const email = emailUnico();
        const r = await superadmin.post(`${PREFIJO}/users`, {
          email,
          password: PASSWORD_E2E,
          name: `${marcador}-${i}`,
          roles: i === 0 ? [SYSTEM_ROLES.DIRECTOR.name] : [],
        });
        expect(r.status).toBe(201);
        ids.push(idDe(r));
      }
      idDirector = ids[0]!;
      idSuspendido = ids[1]!;
      const suspender = await superadmin.patch(`${PREFIJO}/users/${idSuspendido}`, { status: 'SUSPENDED' });
      expect(suspender.status).toBe(200);
    });

    it('cursor: recorre todas las paginas sin duplicar y coincide con la BD', async () => {
      const prisma = prismaE2E();
      const totalReal = await prisma.user.count({ where: { deletedAt: null, name: { contains: marcador } } });
      expect(totalReal).toBe(3);

      const vistos = new Set<string>();
      let cursor: string | undefined;
      let vueltas = 0;
      for (;;) {
        vueltas += 1;
        if (vueltas > 10) throw new Error('Demasiadas paginas: probable bucle infinito en el cursor.');
        const qs = new URLSearchParams({ limit: '2', search: marcador });
        if (cursor) qs.set('cursor', cursor);
        const r = await superadmin.get(`${PREFIJO}/users?${qs.toString()}`);
        expect(r.status).toBe(200);
        for (const item of lista(r)) vistos.add(comoTexto(item.id));
        const pag = paginacion(r);
        if (!comoBooleano(pag.hasNext)) break;
        cursor = comoTexto(pag.nextCursor);
      }
      expect(vistos.size).toBe(totalReal);
    });

    it('pagina: total y totalPages exactos', async () => {
      const r = await superadmin.get(`${PREFIJO}/users?page=1&limit=2&search=${encodeURIComponent(marcador)}`);
      expect(r.status).toBe(200);
      const pag = paginacion(r);
      expect(comoNumero(pag.total)).toBe(3);
      expect(comoNumero(pag.totalPages)).toBe(2);
    });

    it('search encuentra exactamente los usuarios marcados de esta prueba', async () => {
      const r = await superadmin.get(`${PREFIJO}/users?search=${encodeURIComponent(marcador)}&limit=50`);
      expect(lista(r)).toHaveLength(3);
    });

    it('filtra por status=SUSPENDED', async () => {
      const r = await superadmin.get(
        `${PREFIJO}/users?search=${encodeURIComponent(marcador)}&status=SUSPENDED`,
      );
      const items = lista(r);
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe(idSuspendido);
    });

    it('filtra por role=DIRECTOR, cotejado con la BD', async () => {
      const r = await superadmin.get(
        `${PREFIJO}/users?search=${encodeURIComponent(marcador)}&role=${SYSTEM_ROLES.DIRECTOR.name}`,
      );
      const items = lista(r);
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe(idDirector);

      const enBd = await prismaE2E().userRole.count({
        where: { userId: idDirector, role: { name: SYSTEM_ROLES.DIRECTOR.name } },
      });
      expect(enBd).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Ver, editar y borrar
  // ─────────────────────────────────────────────────────────────────────────
  describe('ver, editar y borrar', () => {
    it('GET /users/:id trae el usuario, sin password', async () => {
      const email = emailUnico();
      const alta = await superadmin.post(`${PREFIJO}/users`, {
        email,
        password: PASSWORD_E2E,
        name: `${TAG}-ver-${sufijo()}`,
        roles: [],
      });
      const id = idDe(alta);
      const r = await superadmin.get(`${PREFIJO}/users/${id}`);
      expect(r.status).toBe(200);
      expect(dato(r).email).toBe(email);
      sinCredenciales(r.body);
    });

    it('PATCH /users/:id (administrativo) edita name, reflejado en la BD', async () => {
      const alta = await superadmin.post(`${PREFIJO}/users`, {
        email: emailUnico(),
        password: PASSWORD_E2E,
        name: `${TAG}-edit-${sufijo()}`,
        roles: [],
      });
      const id = idDe(alta);
      const nuevoNombre = `${TAG}-editado-${sufijo()}`;
      const r = await superadmin.patch(`${PREFIJO}/users/${id}`, { name: nuevoNombre });
      expect(r.status).toBe(200);
      expect(dato(r).name).toBe(nuevoNombre);

      const enBd = await prismaE2E().user.findUniqueOrThrow({ where: { id } });
      expect(enBd.name).toBe(nuevoNombre);
    });

    it('PATCH /users/me edita mi propio perfil', async () => {
      const email = emailUnico();
      const alta = await superadmin.post(`${PREFIJO}/users`, {
        email,
        password: PASSWORD_E2E,
        name: `${TAG}-me-${sufijo()}`,
        roles: [],
      });
      expect(alta.status).toBe(201);
      const propio = new Sesion(BASE);
      const login = await propio.login(email, PASSWORD_E2E);
      expect(login.status).toBe(200);

      const nuevoNombre = `${TAG}-me-editado-${sufijo()}`;
      const r = await propio.patch(`${PREFIJO}/users/me`, { name: nuevoNombre });
      expect(r.status).toBe(200);
      expect(dato(r).name).toBe(nuevoNombre);
    });

    it('PATCH /users/me NO acepta status (mass assignment) -> 422', async () => {
      const email = emailUnico();
      const alta = await superadmin.post(`${PREFIJO}/users`, {
        email,
        password: PASSWORD_E2E,
        name: `${TAG}-me2-${sufijo()}`,
        roles: [],
      });
      expect(alta.status).toBe(201);
      const propio = new Sesion(BASE);
      await propio.login(email, PASSWORD_E2E);

      const r = await propio.patch(`${PREFIJO}/users/me`, { status: 'SUSPENDED' });
      expect(r.status).toBe(422);
      expect(comoRegistro(comoRegistro(r.body).error).code).toBe('VALIDATION_ERROR');
    });

    it('PUT /users/:id/roles reemplaza el set completo de roles', async () => {
      const alta = await superadmin.post(`${PREFIJO}/users`, {
        email: emailUnico(),
        password: PASSWORD_E2E,
        name: `${TAG}-roles-${sufijo()}`,
        roles: [SYSTEM_ROLES.ANALISTA.name],
      });
      const id = idDe(alta);
      const r = await superadmin.put(`${PREFIJO}/users/${id}/roles`, { roles: [SYSTEM_ROLES.FARMACIA.name] });
      expect(r.status).toBe(200);
      expect(comoArreglo(dato(r).roles)).toEqual([SYSTEM_ROLES.FARMACIA.name]);

      const filas = await prismaE2E().userRole.findMany({ where: { userId: id }, include: { role: true } });
      expect(filas.map((f) => f.role.name)).toEqual([SYSTEM_ROLES.FARMACIA.name]);
    });

    it('DELETE /users/:id borra logicamente: desaparece del listado y no puede loguear', async () => {
      const email = emailUnico();
      const marcador = `${TAG}-del-${sufijo()}`;
      const alta = await superadmin.post(`${PREFIJO}/users`, {
        email,
        password: PASSWORD_E2E,
        name: marcador,
        roles: [],
      });
      const id = idDe(alta);

      const r = await superadmin.delete(`${PREFIJO}/users/${id}`);
      expect(r.status).toBe(204);

      const consulta = await superadmin.get(`${PREFIJO}/users/${id}`);
      expect(consulta.status).toBe(404);

      const listado = await superadmin.get(`${PREFIJO}/users?search=${encodeURIComponent(marcador)}`);
      expect(lista(listado)).toHaveLength(0);

      const intentoLogin = new Sesion(BASE);
      const login = await intentoLogin.login(email, PASSWORD_E2E);
      expect(login.status).not.toBe(200);

      const enBd = await prismaE2E().user.findUniqueOrThrow({ where: { id } });
      expect(enBd.deletedAt).not.toBeNull();
      expect(enBd.status).toBe('DELETED');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // No-escalada por HTTP real (CLAUDE.md §5, la invariante mas importante)
  // ─────────────────────────────────────────────────────────────────────────
  describe('no-escalada por HTTP real', () => {
    it('ADMIN no puede darse roles a si mismo -> 403', async () => {
      const yo = await admin.get(`${PREFIJO}/users/me`);
      const miId = idDe(yo);
      const r = await admin.put(`${PREFIJO}/users/${miId}/roles`, { roles: [SYSTEM_ROLES.ADMIN.name] });
      expect(r.status).toBe(403);
    });

    it('ADMIN no puede conceder SUPER_ADMIN a otro usuario -> 403, y no se aplica parcialmente', async () => {
      const alta = await superadmin.post(`${PREFIJO}/users`, {
        email: emailUnico(),
        password: PASSWORD_E2E,
        name: `${TAG}-target-sa-${sufijo()}`,
        roles: [],
      });
      const id = idDe(alta);
      // roles:[] en la alta deja al usuario en CONSULTA (el rol por defecto de
      // Better Auth), no en cero roles: lo confirma el propio test de alta
      // "sin roles -> CONSULTA por defecto". El punto de esta prueba es que el
      // intento de escalada NO cambia ese estado.
      const r = await admin.put(`${PREFIJO}/users/${id}/roles`, { roles: [SYSTEM_ROLES.SUPER_ADMIN.name] });
      expect(r.status).toBe(403);

      const filas = await prismaE2E().userRole.findMany({ where: { userId: id }, include: { role: true } });
      expect(filas.map((f) => f.role.name)).toEqual([SYSTEM_ROLES.CONSULTA.name]);
    });

    it('ADMIN no puede administrar (PATCH) al superadmin -> 403', async () => {
      const yoSuper = await superadmin.get(`${PREFIJO}/users/me`);
      const idSuper = idDe(yoSuper);
      const r = await admin.patch(`${PREFIJO}/users/${idSuper}`, { name: 'hackeado' });
      expect(r.status).toBe(403);
    });

    it('un usuario con SOLO users:assign-roles no puede dejar sin roles a un superior', async () => {
      const nombreRol = `e2e-solo-assign-${sufijo()}`;
      const crearRol = await superadmin.post(`${PREFIJO}/roles`, {
        name: nombreRol,
        permissions: [PERMISSIONS.users.assignRoles],
      });
      expect(crearRol.status).toBe(201);

      const email = emailUnico();
      const altaActor = await superadmin.post(`${PREFIJO}/users`, {
        email,
        password: PASSWORD_E2E,
        name: `${TAG}-solo-assign-${sufijo()}`,
        roles: [nombreRol],
      });
      expect(altaActor.status).toBe(201);
      const actor = new Sesion(BASE);
      const login = await actor.login(email, PASSWORD_E2E);
      expect(login.status).toBe(200);

      // Objetivo: el ADMIN de este archivo, mas privilegiado que "solo-assign".
      const yoAdmin = await admin.get(`${PREFIJO}/users/me`);
      const idAdmin = idDe(yoAdmin);

      const r = await actor.put(`${PREFIJO}/users/${idAdmin}/roles`, { roles: [] });
      expect(r.status).toBe(403);

      // El ADMIN objetivo sigue con sus roles intactos: la escritura NO se aplico.
      const sigue = await superadmin.get(`${PREFIJO}/users/${idAdmin}`);
      expect(comoArreglo(dato(sigue).roles)).toContain(SYSTEM_ROLES.ADMIN.name);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Roles
  // ─────────────────────────────────────────────────────────────────────────
  describe('roles', () => {
    let rolPropioId = '';
    const nombreRolPropio = `e2e-rol-${sufijo()}`;

    it('GET /roles lista roles', async () => {
      const r = await admin.get(`${PREFIJO}/roles`);
      expect(r.status).toBe(200);
      expect(lista(r).length).toBeGreaterThan(0);
    });

    it('POST /roles crea un rol e2e-* con permisos', async () => {
      const r = await admin.post(`${PREFIJO}/roles`, {
        name: nombreRolPropio,
        description: 'Rol de prueba T14',
        permissions: [PERMISSIONS.dashboard.read, PERMISSIONS.analytics.read],
      });
      expect(r.status).toBe(201);
      const creado = dato(r);
      rolPropioId = comoTexto(creado.id);
      expect(creado.isSystem).toBe(false);
      expect(comoArreglo(creado.permissions).sort()).toEqual(
        [PERMISSIONS.analytics.read, PERMISSIONS.dashboard.read].sort(),
      );
    });

    it('PATCH /roles/:id edita el rol propio', async () => {
      const r = await admin.patch(`${PREFIJO}/roles/${rolPropioId}`, { description: 'Editado' });
      expect(r.status).toBe(200);
      expect(dato(r).description).toBe('Editado');
    });

    it('PUT /roles/:id/permissions rechaza el comodin "*", incluso para el superadmin', async () => {
      const r = await superadmin.put(`${PREFIJO}/roles/${rolPropioId}/permissions`, {
        permissions: [WILDCARD_PERMISSION],
      });
      expect(r.status).toBe(403);
    });

    it('los roles de sistema son inmutables por API (PATCH y PUT permissions)', async () => {
      const buscar = await admin.get(`${PREFIJO}/roles?search=ADMIN&limit=50`);
      const filaAdmin = lista(buscar).find((rol) => rol.name === SYSTEM_ROLES.ADMIN.name);
      if (!filaAdmin) throw new Error('No se encontro el rol de sistema ADMIN en el listado.');
      const idAdminRol = comoTexto(filaAdmin.id);

      const patch = await superadmin.patch(`${PREFIJO}/roles/${idAdminRol}`, { description: 'hackeado' });
      expect(patch.status).toBe(403);

      const permisos = await superadmin.put(`${PREFIJO}/roles/${idAdminRol}/permissions`, {
        permissions: [PERMISSIONS.dashboard.read],
      });
      expect(permisos.status).toBe(403);
    });

    it('DELETE /roles/:id rechaza un rol con usuarios asignados -> 409', async () => {
      const nombre = `e2e-con-usuario-${sufijo()}`;
      const crear = await superadmin.post(`${PREFIJO}/roles`, {
        name: nombre,
        permissions: [PERMISSIONS.dashboard.read],
      });
      expect(crear.status).toBe(201);
      const idRol = idDe(crear);

      const altaUsuario = await superadmin.post(`${PREFIJO}/users`, {
        email: emailUnico(),
        password: PASSWORD_E2E,
        name: `${TAG}-con-rol-${sufijo()}`,
        roles: [nombre],
      });
      expect(altaUsuario.status).toBe(201);

      const r = await superadmin.delete(`${PREFIJO}/roles/${idRol}`);
      expect(r.status).toBe(409);
    });

    it('DELETE /roles/:id borra un rol vacio', async () => {
      const r = await admin.delete(`${PREFIJO}/roles/${rolPropioId}`);
      expect(r.status).toBe(204);

      const consulta = await admin.get(`${PREFIJO}/roles/${rolPropioId}`);
      expect(consulta.status).toBe(404);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /permissions
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET /permissions', () => {
    it('devuelve exactamente el catalogo de PERMISSION_LIST, agrupado', async () => {
      const r = await admin.get(`${PREFIJO}/permissions`);
      expect(r.status).toBe(200);
      const datos = dato(r);
      expect(comoNumero(datos.total)).toBe(PERMISSION_LIST.length);

      const grupos = comoArreglo(datos.groups).map(comoRegistro);
      const accionesRecibidas = grupos
        .flatMap((g) => comoArreglo(g.permissions).map((p) => comoTexto(comoRegistro(p).action)))
        .sort();
      const accionesEsperadas = PERMISSION_LIST.map((p) => p.action).sort();
      expect(accionesRecibidas).toEqual(accionesEsperadas);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Auditoria
  // ─────────────────────────────────────────────────────────────────────────
  describe('auditoria', () => {
    it('user.created queda auditado con actorEmail, filtrando por action/actorId/desde, sin userAgent', async () => {
      const antes = new Date(Date.now() - 1000).toISOString();
      const alta = await superadmin.post(`${PREFIJO}/users`, {
        email: emailUnico(),
        password: PASSWORD_E2E,
        name: `${TAG}-audit-${sufijo()}`,
        roles: [],
      });
      const idCreado = idDe(alta);
      const idSuper = idDe(await superadmin.get(`${PREFIJO}/users/me`));

      const r = await superadmin.get(
        `${PREFIJO}/audit?action=user.created&actorId=${idSuper}&desde=${encodeURIComponent(antes)}&limit=50`,
      );
      expect(r.status).toBe(200);
      const items = lista(r);
      const fila = items.find((f) => f.targetId === idCreado);
      if (!fila) throw new Error('No aparecio la entrada de auditoria user.created del usuario recien creado.');
      expect(fila.actorEmail).toBe(credenciales.superadmin.email);
      expect(fila.action).toBe('user.created');
      expect('userAgent' in fila).toBe(false);

      // Cotejo independiente contra la BD (E0: consulta propia, no importa servicios).
      const filaBd = await prismaE2E().auditLog.findUniqueOrThrow({ where: { id: comoTexto(fila.id) } });
      expect(filaBd.targetId).toBe(idCreado);
      expect(filaBd.actorEmail).toBe(credenciales.superadmin.email);
      expect(filaBd.action).toBe('user.created');
    });

    it('user.roles.set y role.created (generados por tests anteriores de este archivo) tambien aparecen', async () => {
      const r1 = await superadmin.get(`${PREFIJO}/audit?action=user.roles.set&limit=1`);
      expect(r1.status).toBe(200);
      expect(lista(r1).length).toBeGreaterThan(0);

      const r2 = await superadmin.get(`${PREFIJO}/audit?action=role.created&limit=1`);
      expect(r2.status).toBe(200);
      expect(lista(r2).length).toBeGreaterThan(0);
    });

    it('filtra por cursor y por rango desde/hasta', async () => {
      const primera = await superadmin.get(`${PREFIJO}/audit?limit=1`);
      expect(primera.status).toBe(200);
      const items1 = lista(primera);
      expect(items1).toHaveLength(1);

      const pag = paginacion(primera);
      if (comoBooleano(pag.hasNext)) {
        const segunda = await superadmin.get(`${PREFIJO}/audit?limit=1&cursor=${comoTexto(pag.nextCursor)}`);
        expect(segunda.status).toBe(200);
        const items2 = lista(segunda);
        expect(items2).toHaveLength(1);
        expect(items2[0]!.id).not.toBe(items1[0]!.id);
      }

      const futuro = new Date(Date.now() + 60_000).toISOString();
      const vacio = await superadmin.get(`${PREFIJO}/audit?desde=${encodeURIComponent(futuro)}`);
      expect(vacio.status).toBe(200);
      expect(lista(vacio)).toHaveLength(0);
    });
  });
});
