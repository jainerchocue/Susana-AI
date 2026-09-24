import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, cargarFixturesHis, crearUsuarioConRol, getApp, limpiar, prisma } from '../helpers';

/**
 * CRUD de `procedures` (catalogo de procedimientos CUPS, TC3), contra los
 * fixtures de `tests/fixtures/his` (Servicios.txt: 5 filas, 3 codigos unicos:
 * 902210, 906914, 806104 -> his_procedures tiene exactamente 3 filas tras
 * `cargarFixturesHis()`).
 *
 * Los registros sinteticos de este archivo usan el prefijo `ZE2E` (C0):
 * `ZE2E0PROC01` se limpia en `afterAll` por si un test se corta a mitad.
 */
describe('CRUD de procedimientos (TC3)', () => {
  beforeAll(async () => {
    await getApp();
    await limpiar();
    await cargarFixturesHis();
  }, 30_000);

  afterAll(async () => {
    // Red de seguridad: si algun test se corta a mitad, no deja el codigo sintetico.
    await prisma.procedure.deleteMany({ where: { code: { startsWith: 'ZE2E' } } });
    await limpiar();
    await prisma.$disconnect();
  });

  describe('GET /api/v1/procedures', () => {
    it('401 sin sesion', async () => {
      const res = await api().get('/api/v1/procedures');
      expect(res.status).toBe(401);
    });

    it('403 sin services:read (FARMACIA)', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api().get('/api/v1/procedures').set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(403);
    });

    it('lista el catalogo completo (3 codigos) con paginacion por cursor', async () => {
      const usuario = await crearUsuarioConRol('ANALISTA');
      const primera = await api()
        .get('/api/v1/procedures?limit=2')
        .set('Authorization', `Bearer ${usuario.token}`);

      expect(primera.status).toBe(200);
      expect(primera.body.data).toHaveLength(2);
      expect(primera.body.pagination.hasNext).toBe(true);
      expect(primera.body.pagination.nextCursor).toBeTruthy();

      const segunda = await api()
        .get(`/api/v1/procedures?limit=2&cursor=${primera.body.pagination.nextCursor}`)
        .set('Authorization', `Bearer ${usuario.token}`);

      expect(segunda.status).toBe(200);
      expect(segunda.body.data).toHaveLength(1);
      expect(segunda.body.pagination.hasNext).toBe(false);
      expect(segunda.body.pagination.nextCursor).toBeNull();

      // Sin solapamiento ni huecos: la union de ambas paginas son los 3 codigos.
      const codigos = [...primera.body.data, ...segunda.body.data].map((p: { code: string }) => p.code).sort();
      expect(codigos).toEqual(['806104', '902210', '906914']);
    });

    it('un query param desconocido responde 422 (.strict())', async () => {
      const usuario = await crearUsuarioConRol('ANALISTA');
      const res = await api()
        .get('/api/v1/procedures?x=1')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(422);
    });
  });

  describe('POST /api/v1/procedures', () => {
    it('401 sin sesion, 403 sin data:manage', async () => {
      const sinSesion = await api().post('/api/v1/procedures').send({ code: 'ZE2E0PROC01', name: 'x' });
      expect(sinSesion.status).toBe(401);

      const analista = await crearUsuarioConRol('ANALISTA');
      const sinPermiso = await api()
        .post('/api/v1/procedures')
        .set('Authorization', `Bearer ${analista.token}`)
        .send({ code: 'ZE2E0PROC01', name: 'x' });
      expect(sinPermiso.status).toBe(403);
    });

    it('crea un procedimiento nuevo (201) y responde 409 si el codigo ya existe', async () => {
      const admin = await crearUsuarioConRol('ADMIN');
      const creado = await api()
        .post('/api/v1/procedures')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ code: 'ze2e0proc01', name: 'Procedimiento sintetico E2E' });

      expect(creado.status).toBe(201);
      // `codigoHis` normaliza a mayusculas.
      expect(creado.body.data).toEqual({ code: 'ZE2E0PROC01', name: 'Procedimiento sintetico E2E' });

      const duplicado = await api()
        .post('/api/v1/procedures')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ code: 'ZE2E0PROC01', name: 'Otro nombre' });
      expect(duplicado.status).toBe(409);

      await prisma.procedure.delete({ where: { code: 'ZE2E0PROC01' } });
    });

    it('422 con un codigo con formato invalido', async () => {
      const admin = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .post('/api/v1/procedures')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ code: 'ab', name: 'x' });
      expect(res.status).toBe(422);
    });
  });

  describe('GET/PATCH/DELETE /api/v1/procedures/:code', () => {
    it('404 sobre un codigo inexistente (get/patch/delete)', async () => {
      const admin = await crearUsuarioConRol('ADMIN');
      const get = await api()
        .get('/api/v1/procedures/ZE2ENOEXISTE')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(get.status).toBe(404);

      const patch = await api()
        .patch('/api/v1/procedures/ZE2ENOEXISTE')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'x' });
      expect(patch.status).toBe(404);

      const del = await api()
        .delete('/api/v1/procedures/ZE2ENOEXISTE')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(del.status).toBe(404);
    });

    it('edita el nombre; `code` es inmutable (rechazado por .strict())', async () => {
      const admin = await crearUsuarioConRol('ADMIN');
      await prisma.procedure.create({ data: { code: 'ZE2E0PROC02', name: 'Original' } });

      const editado = await api()
        .patch('/api/v1/procedures/ZE2E0PROC02')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Editado' });
      expect(editado.status).toBe(200);
      expect(editado.body.data).toEqual({ code: 'ZE2E0PROC02', name: 'Editado' });

      const conCode = await api()
        .patch('/api/v1/procedures/ZE2E0PROC02')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ code: 'OTRO' });
      expect(conCode.status).toBe(422);

      await prisma.procedure.delete({ where: { code: 'ZE2E0PROC02' } });
    });

    it('409 al borrar un procedimiento con service-records asociados; sin dependientes, 204', async () => {
      const admin = await crearUsuarioConRol('ADMIN');

      // 902210 (HEMOGRAMA) tiene 3 filas en his_service_records (fixtures: OidS 1, 3, 4).
      const conDependientes = await api()
        .delete('/api/v1/procedures/902210')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(conDependientes.status).toBe(409);
      expect(conDependientes.body.error.message).toMatch(/registro/i);
      // No se borro de verdad.
      expect(await prisma.procedure.findUnique({ where: { code: '902210' } })).not.toBeNull();

      await prisma.procedure.create({ data: { code: 'ZE2E0PROC03', name: 'Sin dependientes' } });
      const sinDependientes = await api()
        .delete('/api/v1/procedures/ZE2E0PROC03')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(sinDependientes.status).toBe(204);
      expect(await prisma.procedure.findUnique({ where: { code: 'ZE2E0PROC03' } })).toBeNull();
    });
  });
});
