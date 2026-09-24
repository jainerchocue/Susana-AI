import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  api,
  crearUsuarioCon,
  crearUsuarioNormal,
  getApp,
  limpiar,
  login,
  permisosDe,
  prisma,
  rolesDe,
} from '../helpers';
import { PERMISSIONS } from '../../src/core/rbac/permissions';

/**
 * REGRESION DE LAS ESCALADAS C-01, C-02 y A-17.
 *
 * Los tres vectores existieron y se explotaron contra la aplicacion real:
 *  - C-01: con `users:assign-roles` uno se concedia superadmin.
 *  - C-02: con `roles:assign-permissions` uno se concedia el comodin.
 *  - A-17: con solo `users:assign-roles` uno DEJABA SIN ROLES al superadmin.
 *
 * Ningun cambio en core/rbac ni en los servicios de users/roles debe fusionarse
 * si alguno de estos tests falla.
 */
describe('RBAC · prevencion de escalada de privilegios', () => {
  beforeAll(async () => {
    await getApp();
    await limpiar();
  });

  afterAll(async () => {
    await limpiar();
    await prisma.$disconnect();
  });

  describe('C-01 · users:assign-roles', () => {
    it('NO permite auto-asignarse superadmin', async () => {
      const gestor = await crearUsuarioCon([PERMISSIONS.users.read, PERMISSIONS.users.assignRoles]);

      const res = await api()
        .put(`/api/v1/users/${gestor.id}/roles`)
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ roles: ['SUPER_ADMIN'] });

      expect(res.status).toBe(403);
      expect(await permisosDe(gestor.id)).not.toContain('*');
      expect(await rolesDe(gestor.id)).not.toContain('SUPER_ADMIN');
    });

    it('NO permite editar los roles propios, ni siquiera para quitarselos', async () => {
      const gestor = await crearUsuarioCon([PERMISSIONS.users.assignRoles]);

      const res = await api()
        .put(`/api/v1/users/${gestor.id}/roles`)
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ roles: [] });

      expect(res.status).toBe(403);
    });

    it('NO permite conceder a OTRO un permiso que el actor no tiene', async () => {
      const gestor = await crearUsuarioCon([PERMISSIONS.users.assignRoles]);
      const victima = await crearUsuarioNormal();

      const res = await api()
        .put(`/api/v1/users/${victima.id}/roles`)
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ roles: ['ADMIN'] });

      expect(res.status).toBe(403);
      expect(await rolesDe(victima.id)).not.toContain('ADMIN');
    });

    it('SI permite conceder un rol cuyos permisos el actor ya posee', async () => {
      const lector = await prisma.role.create({
        data: {
          name: `lector-${Date.now()}`,
          permissions: { create: [{ permission: { connect: { action: PERMISSIONS.users.read } } }] },
        },
      });

      // CONSULTA (el rol por defecto de crearUsuarioNormal) ya no es un rol
      // vacio: tiene dashboard:read. El gestor necesita poseerlo tambien, o
      // assertPuedeAdministrarUsuario ve un permiso de la victima que el
      // gestor no tiene y la trata como "de mas rango".
      const gestor = await crearUsuarioCon([
        PERMISSIONS.users.read,
        PERMISSIONS.users.assignRoles,
        PERMISSIONS.dashboard.read,
      ]);
      const victima = await crearUsuarioNormal();

      const res = await api()
        .put(`/api/v1/users/${victima.id}/roles`)
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ roles: [lector.name] });

      expect(res.status).toBe(200);
      expect(await rolesDe(victima.id)).toContain(lector.name);
    });
  });

  /**
   * A-17. El sentido que faltaba.
   *
   * `assertPuedeAsignarRoles` solo miraba los permisos CONCEDIDOS, asi que un
   * set vacio pasaba trivialmente el superset check: nadie concedia nada. Un
   * actor con solo `users:assign-roles` —que es un permiso del rol `admin` de
   * serie— mandaba `roles: []` contra el superadmin, recibia 200, y lo dejaba
   * con cero roles y cero sesiones. Recuperarse exigia acceso al servidor.
   *
   * El arreglo es `assertPuedeAdministrarUsuario` en `setRoles`.
   */
  describe('A-17 · quitar autoridad a un superior', () => {
    it('NO permite vaciar los roles del superadmin', async () => {
      const gestor = await crearUsuarioCon([PERMISSIONS.users.assignRoles]);
      const supers = await prisma.user.findFirstOrThrow({
        where: { roles: { some: { role: { name: 'SUPER_ADMIN' } } }, deletedAt: null },
        select: { id: true },
      });

      const res = await api()
        .put(`/api/v1/users/${supers.id}/roles`)
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ roles: [] });

      expect(res.status).toBe(403);
      // Lo esencial: el superadmin conserva su autoridad.
      expect(await rolesDe(supers.id)).toContain('SUPER_ADMIN');
      expect(await permisosDe(supers.id)).toContain('*');
    });

    it('NO permite degradar a un administrador de mas rango', async () => {
      const gestor = await crearUsuarioCon([PERMISSIONS.users.assignRoles]);
      const superior = await crearUsuarioCon([
        PERMISSIONS.users.assignRoles,
        PERMISSIONS.users.delete,
        PERMISSIONS.roles.delete,
      ]);

      const res = await api()
        .put(`/api/v1/users/${superior.id}/roles`)
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ roles: [] });

      expect(res.status).toBe(403);
      expect((await rolesDe(superior.id)).length).toBeGreaterThan(0);
    });

    it('SI permite gestionar los roles de un usuario de menor rango', async () => {
      // Mismo motivo que arriba: la victima trae dashboard:read de CONSULTA.
      const gestor = await crearUsuarioCon([
        PERMISSIONS.users.read,
        PERMISSIONS.users.assignRoles,
        PERMISSIONS.dashboard.read,
      ]);
      const victima = await crearUsuarioNormal();

      const res = await api()
        .put(`/api/v1/users/${victima.id}/roles`)
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ roles: [] });

      expect(res.status).toBe(200);
      expect(await rolesDe(victima.id)).toEqual([]);
    });
  });

  describe('C-02 · roles:assign-permissions', () => {
    it('NO permite concederse el comodin "*"', async () => {
      const gestor = await crearUsuarioCon([PERMISSIONS.roles.assignPermissions]);

      const res = await api()
        .put(`/api/v1/roles/${gestor.roleId}/permissions`)
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ permissions: ['*'] });

      expect(res.status).toBe(403);
      expect(await permisosDe(gestor.id)).not.toContain('*');
    });

    it('NO permite modificar un rol de sistema', async () => {
      const gestor = await crearUsuarioCon([PERMISSIONS.roles.assignPermissions, PERMISSIONS.roles.read]);
      const admin = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });

      const res = await api()
        .put(`/api/v1/roles/${admin.id}/permissions`)
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ permissions: [PERMISSIONS.users.read] });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/rol de sistema/i);
    });

    it('NO permite modificar un rol que el propio actor ostenta', async () => {
      const gestor = await crearUsuarioCon([PERMISSIONS.roles.assignPermissions, PERMISSIONS.users.read]);

      const res = await api()
        .put(`/api/v1/roles/${gestor.roleId}/permissions`)
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ permissions: [PERMISSIONS.users.read] });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/rol que tu mismo/i);
    });

    it('NO permite conceder permisos que el actor no posee', async () => {
      const gestor = await crearUsuarioCon([PERMISSIONS.roles.assignPermissions]);
      const otro = await prisma.role.create({ data: { name: `otro-${Date.now()}` } });

      const res = await api()
        .put(`/api/v1/roles/${otro.id}/permissions`)
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ permissions: [PERMISSIONS.users.delete] });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/no posees/i);
    });

    it('NO permite colar el comodin al CREAR un rol', async () => {
      const gestor = await crearUsuarioCon([PERMISSIONS.roles.create]);

      const res = await api()
        .post('/api/v1/roles')
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ name: `atacante-${Date.now()}`, permissions: ['*'] });

      expect(res.status).toBe(403);
    });

    it('NO permite BORRAR un rol con permisos por encima de los del actor', async () => {
      // Sin la guarda en remove(), quien tuviera roles:delete destruia autoridad
      // que nunca habria podido crear.
      const gestor = await crearUsuarioCon([PERMISSIONS.roles.delete]);
      const potente = await prisma.role.create({
        data: {
          name: `potente-${Date.now()}`,
          permissions: { create: [{ permission: { connect: { action: PERMISSIONS.users.delete } } }] },
        },
      });

      const res = await api()
        .delete(`/api/v1/roles/${potente.id}`)
        .set('Authorization', `Bearer ${gestor.token}`);

      expect(res.status).toBe(403);
      expect(await prisma.role.findUnique({ where: { id: potente.id } })).not.toBeNull();
    });
  });

  describe('Administracion de usuarios de mayor rango', () => {
    it('NO permite suspender a un usuario con mas privilegios', async () => {
      const gestor = await crearUsuarioCon([PERMISSIONS.users.update]);
      const superior = await crearUsuarioCon([
        PERMISSIONS.users.update,
        PERMISSIONS.users.delete,
        PERMISSIONS.roles.delete,
      ]);

      const res = await api()
        .patch(`/api/v1/users/${superior.id}`)
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ status: 'SUSPENDED' });

      expect(res.status).toBe(403);
      const estado = await prisma.user.findUniqueOrThrow({ where: { id: superior.id } });
      expect(estado.status).toBe('ACTIVE');
    });

    it('NO permite borrar a un usuario con mas privilegios', async () => {
      const gestor = await crearUsuarioCon([PERMISSIONS.users.delete]);
      const superior = await crearUsuarioCon([PERMISSIONS.users.delete, PERMISSIONS.roles.create]);

      const res = await api()
        .delete(`/api/v1/users/${superior.id}`)
        .set('Authorization', `Bearer ${gestor.token}`);

      expect(res.status).toBe(403);
    });
  });

  describe('A-01 · mass assignment en el perfil propio', () => {
    it('rechaza `status` en PATCH /users/me con 422', async () => {
      const usuario = await crearUsuarioNormal();

      const res = await api()
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ name: 'X', status: 'SUSPENDED' });

      expect(res.status).toBe(422);
      const estado = await prisma.user.findUniqueOrThrow({ where: { id: usuario.id } });
      expect(estado.status).toBe('ACTIVE');
    });

    it('rechaza cualquier campo desconocido (.strict)', async () => {
      const usuario = await crearUsuarioNormal();

      const res = await api()
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ name: 'X', isPremium: true, credits: 999 });

      expect(res.status).toBe(422);
    });

    it('SI permite editar los campos legitimos del perfil', async () => {
      const usuario = await crearUsuarioNormal();

      const res = await api()
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ name: 'Nombre nuevo' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Nombre nuevo');
    });
  });

  describe('M-03 · XSS almacenado via image', () => {
    it.each([
      'javascript:alert(document.cookie)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'file:///etc/passwd',
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:6379/',
    ])('rechaza %s', async (url) => {
      const usuario = await crearUsuarioNormal();

      const res = await api()
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ image: url });

      expect(res.status).toBe(422);
    });

    it('acepta una URL https legitima', async () => {
      const usuario = await crearUsuarioNormal();

      const res = await api()
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ image: 'https://cdn.example.com/avatar.png' });

      expect(res.status).toBe(200);
    });
  });

  describe('Rastro de auditoria', () => {
    it('congela el correo del actor, para que sobreviva a su borrado', async () => {
      // La columna existia y NADIE la rellenaba: 0 de 55 filas la tenian.
      // Sin ella, borrar al actor dejaba el rastro en un UUID huerfano.
      // Mismo motivo que en C-01/A-17 arriba: la victima trae dashboard:read
      // de CONSULTA y el gestor necesita poseerlo para poder administrarla.
      const gestor = await crearUsuarioCon([
        PERMISSIONS.users.read,
        PERMISSIONS.users.assignRoles,
        PERMISSIONS.dashboard.read,
      ]);
      const victima = await crearUsuarioNormal();

      await api()
        .put(`/api/v1/users/${victima.id}/roles`)
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ roles: [] });

      const rastro = await prisma.auditLog.findFirst({
        where: { action: 'user.roles.set', targetId: victima.id },
        orderBy: { createdAt: 'desc' },
      });

      expect(rastro).not.toBeNull();
      expect(rastro!.actorId).toBe(gestor.id);
      expect(rastro!.actorEmail).toBe(gestor.email);
    });

    it('es append-only: el trigger rechaza UPDATE y DELETE', async () => {
      const fila = await prisma.auditLog.create({
        data: { action: 'user.updated', targetType: 'user', metadata: { prueba: true } },
      });

      await expect(
        prisma.$executeRaw`UPDATE audit_logs SET action = 'manipulado' WHERE id = ${fila.id}::uuid`,
      ).rejects.toThrow(/append-only/i);

      await expect(
        prisma.$executeRaw`DELETE FROM audit_logs WHERE id = ${fila.id}::uuid`,
      ).rejects.toThrow(/append-only/i);
    });
  });

  describe('Integridad en la base de datos', () => {
    it('rechaza un correo con mayusculas (CHECK, no solo Zod)', async () => {
      // Sustituye al indice funcional lower(email), que Prisma borraba al
      // diffear. Un CHECK no lo gestiona Prisma, asi que no puede derivar.
      await expect(
        prisma.$executeRaw`
          INSERT INTO users (id, name, email, "emailVerified", "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), 'X', 'MAYUSCULAS@test.local', false, now(), now())`,
      ).rejects.toThrow(/users_email_minusculas/i);
    });

    it('rechaza un permiso con formato invalido', async () => {
      await expect(
        prisma.$executeRaw`INSERT INTO permissions (id, action, "group", "createdAt")
                           VALUES (gen_random_uuid(), 'FormatoMalo', 'x', now())`,
      ).rejects.toThrow(/permissions_action_formato/i);
    });

    it('rechaza un borrado logico incoherente', async () => {
      await expect(
        prisma.$executeRaw`
          INSERT INTO users (id, name, email, "emailVerified", status, "deletedAt", "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), 'X', 'incoherente@test.local', false, 'ACTIVE', now(), now(), now())`,
      ).rejects.toThrow(/users_borrado_coherente/i);
    });
  });

  describe('Sesion y revocacion', () => {
    it('cambiar los roles invalida las sesiones del afectado', async () => {
      const usuario = await crearUsuarioNormal();
      const token = await login(usuario.email);
      expect((await api().get('/api/v1/users/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);

      const supers = await prisma.user.findFirstOrThrow({
        where: { roles: { some: { role: { name: 'SUPER_ADMIN' } } }, deletedAt: null },
      });
      const tokenAdmin = await login(supers.email, process.env.SEED_ADMIN_PASSWORD ?? 'TestAdmin123!seguro');

      await api()
        .put(`/api/v1/users/${usuario.id}/roles`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ roles: ['CONSULTA'] });

      expect((await api().get('/api/v1/users/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    });

    it('suspender a alguien le corta el acceso de inmediato', async () => {
      const usuario = await crearUsuarioNormal();
      const supers = await prisma.user.findFirstOrThrow({
        where: { roles: { some: { role: { name: 'SUPER_ADMIN' } } }, deletedAt: null },
      });
      const tokenAdmin = await login(supers.email, process.env.SEED_ADMIN_PASSWORD ?? 'TestAdmin123!seguro');

      const res = await api()
        .patch(`/api/v1/users/${usuario.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ status: 'SUSPENDED' });
      expect(res.status).toBe(200);

      const despues = await api().get('/api/v1/users/me').set('Authorization', `Bearer ${usuario.token}`);
      expect(despues.status).toBe(401);
    });
  });
});
