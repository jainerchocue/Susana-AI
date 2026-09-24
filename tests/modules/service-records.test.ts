import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Response } from 'supertest';
import { api, cargarFixturesHis, crearUsuarioConRol, getApp, limpiar, prisma } from '../helpers';

/** `res.body` es `any` (supertest): centraliza el cast en un solo sitio en vez de esparcirlo por cada `it`. */
function idsDe(res: Response): number[] {
  return (res.body.data as Array<{ id: number }>).map((r) => r.id);
}

/**
 * CRUD de `service-records` (his_service_records, Servicios.txt, TC3).
 *
 * El primer bloque ("Rendimiento...") corre ANTES de tocar la BD: se apoya en
 * lo que ya este cargado en `hospital_test_c` en el momento de arrancar la
 * suite. Para el reporte de la tarea se corrio una vez con las 582.357 filas
 * reales importadas a mano (`DATABASE_URL=.../hospital_test_c npx tsx
 * src/scripts/import-data.ts --dir data/raw`) ANTES de este archivo, sin que
 * ningun otro test de este archivo (ni de otro) hubiera llamado aun a
 * `cargarFixturesHis()` (que sustituye esas filas por los 6 fixtures
 * pequeños). Si se corre en otro orden (p. ej. solo, repetidas veces, o
 * despues de que otro archivo ya cargo los fixtures), el cotejo contra Prisma
 * sigue siendo valido a cualquier escala: solo el umbral de tiempo se salta
 * si la tabla ya no tiene el volumen real (documentado en el propio test).
 */
describe('Rendimiento y cotejo con la BD (his_service_records)', () => {
  beforeAll(async () => {
    await getApp();
  });

  it('listado filtrado (area+specialty): coincide con Prisma directo; mide el tiempo con dataset real', async () => {
    const totalActual = await prisma.serviceRecord.count();
    const usuario = await crearUsuarioConRol('DIRECTOR');

    const inicio = performance.now();
    const res = await api()
      .get('/api/v1/service-records?limit=50&area=LABORATORIO%20CLINICO&specialty=MEDICINA%20GENERAL')
      .set('Authorization', `Bearer ${usuario.token}`);
    const ms = performance.now() - inicio;

    expect(res.status).toBe(200);

    const directos = await prisma.serviceRecord.findMany({
      where: { area: 'LABORATORIO CLINICO', specialty: 'MEDICINA GENERAL' },
      orderBy: { id: 'asc' },
      take: 50,
    });
    const idsApi = (res.body.data as Array<{ id: number }>).map((r) => r.id);
    expect(idsApi).toEqual(directos.map((d) => d.id));

    // eslint-disable-next-line no-console -- cifra real para el reporte de la tarea, no ruido de CI.
    console.log(`[TC3] GET /service-records filtrado (${totalActual} filas en la tabla): ${ms.toFixed(1)} ms`);
    if (totalActual >= 100_000) {
      // Umbral generoso (evita flakiness en CI compartido) sobre un indice
      // compuesto (area, providedAt) + filtro adicional en memoria por specialty.
      expect(ms).toBeLessThan(5_000);
    }
  });

  it('cursor entero: la union de dos paginas no solapa ni deja huecos frente a Prisma', async () => {
    const total = await prisma.serviceRecord.count();
    if (total === 0) return; // nada que paginar (defensivo; no ocurre en este entorno)

    const usuario = await crearUsuarioConRol('DIRECTOR');
    const limit = Math.min(25, Math.max(1, Math.floor(total / 2)));

    const pagina1 = await api()
      .get(`/api/v1/service-records?limit=${limit}`)
      .set('Authorization', `Bearer ${usuario.token}`);
    expect(pagina1.status).toBe(200);
    const ids1 = (pagina1.body.data as Array<{ id: number }>).map((r) => r.id);

    const directosPagina1 = await prisma.serviceRecord.findMany({ orderBy: { id: 'asc' }, take: limit });
    expect(ids1).toEqual(directosPagina1.map((d) => d.id));

    if (!pagina1.body.pagination.hasNext) return;

    const pagina2 = await api()
      .get(`/api/v1/service-records?limit=${limit}&cursor=${pagina1.body.pagination.nextCursor}`)
      .set('Authorization', `Bearer ${usuario.token}`);
    const ids2 = (pagina2.body.data as Array<{ id: number }>).map((r) => r.id);

    // Sin solapamiento entre paginas consecutivas.
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
    // Sin huecos: el ultimo id de la pagina 1 es justo el cursor; el primero
    // de la pagina 2 es el siguiente id EXISTENTE mayor que el cursor.
    const directosPagina2 = await prisma.serviceRecord.findMany({
      orderBy: { id: 'asc' },
      cursor: { id: ids1[ids1.length - 1]! },
      skip: 1,
      take: limit,
    });
    expect(ids2).toEqual(directosPagina2.map((d) => d.id));
  });
});

describe('CRUD de service-records (fixtures pequeños, TC3)', () => {
  beforeAll(async () => {
    await getApp();
    await limpiar();
    await cargarFixturesHis();
  }, 30_000);

  afterAll(async () => {
    await prisma.serviceRecord.deleteMany({ where: { id: { gte: 9_000_000 } } });
    await prisma.procedure.deleteMany({ where: { code: { startsWith: 'ZE2E' } } });
    await limpiar();
    await prisma.$disconnect();
  });

  describe('GET /api/v1/service-records', () => {
    it('401 sin sesion; 403 sin services:read (FARMACIA)', async () => {
      const sinSesion = await api().get('/api/v1/service-records');
      expect(sinSesion.status).toBe(401);

      const farmacia = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .get('/api/v1/service-records')
        .set('Authorization', `Bearer ${farmacia.token}`);
      expect(res.status).toBe(403);
    });

    it('filtra por admissionId, code, area, specialty y rango de providedAt', async () => {
      const usuario = await crearUsuarioConRol('ANALISTA');

      const porIngreso = await api()
        .get('/api/v1/service-records?admissionId=5001')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(idsDe(porIngreso).sort()).toEqual([1, 2]);

      const porCodigo = await api()
        .get('/api/v1/service-records?code=902210')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(idsDe(porCodigo).sort()).toEqual([1, 3, 4]);

      const porEspecialidad = await api()
        .get('/api/v1/service-records?specialty=PEDIATRIA')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(idsDe(porEspecialidad)).toEqual([3]);

      const porArea = await api()
        .get('/api/v1/service-records?area=CIRUGIA')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(idsDe(porArea)).toEqual([5]);

      // providedAt de OidS=5 (806104) = 2026-06-05 14:00 local = 19:00 UTC.
      const porRango = await api()
        .get('/api/v1/service-records?desde=2026-06-05T00:00:00.000Z&hasta=2026-06-06T00:00:00.000Z')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(idsDe(porRango)).toEqual([5]);
    });

    it('un query param desconocido responde 422', async () => {
      const usuario = await crearUsuarioConRol('ANALISTA');
      const res = await api()
        .get('/api/v1/service-records?desconocido=1')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(422);
    });
  });

  describe('POST /api/v1/service-records', () => {
    it('401 sin sesion; 403 sin data:manage (ANALISTA tiene services:read pero no data:manage)', async () => {
      const cuerpo = {
        id: 9_000_001,
        admissionId: 5001,
        code: 'ZE2E777',
        procedureName: 'Servicio sintetico E2E',
        quantity: 1,
        providedAt: '2026-06-01T20:00:00-05:00',
        areaCode: 'ZE2',
        area: 'AREA E2E',
        specialty: 'ESPECIALIDAD E2E',
      };
      const sinSesion = await api().post('/api/v1/service-records').send(cuerpo);
      expect(sinSesion.status).toBe(401);

      const analista = await crearUsuarioConRol('ANALISTA');
      const sinPermiso = await api()
        .post('/api/v1/service-records')
        .set('Authorization', `Bearer ${analista.token}`)
        .send(cuerpo);
      expect(sinPermiso.status).toBe(403);
    });

    it('`executed` no es un campo de este recurso: enviarlo responde 422 (.strict())', async () => {
      const admin = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .post('/api/v1/service-records')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          id: 9_000_002,
          admissionId: 5001,
          code: '902210',
          quantity: 1,
          providedAt: '2026-06-01T20:00:00-05:00',
          areaCode: 'ZE2',
          area: 'AREA E2E',
          specialty: 'ESP E2E',
          executed: 'si',
        });
      expect(res.status).toBe(422);
    });

    it('404 con un admissionId inexistente', async () => {
      const admin = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .post('/api/v1/service-records')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          id: 9_000_003,
          admissionId: 9_999_999,
          code: '902210',
          quantity: 1,
          providedAt: '2026-06-01T20:00:00-05:00',
          areaCode: 'ZE2',
          area: 'AREA E2E',
          specialty: 'ESP E2E',
        });
      expect(res.status).toBe(404);
    });

    it('422 si el codigo es nuevo y falta procedureName', async () => {
      const admin = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .post('/api/v1/service-records')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          id: 9_000_004,
          admissionId: 5001,
          code: 'ZE2E888',
          quantity: 1,
          providedAt: '2026-06-01T20:00:00-05:00',
          areaCode: 'ZE2',
          area: 'AREA E2E',
          specialty: 'ESP E2E',
        });
      expect(res.status).toBe(422);
      expect(res.body.error.details?.[0]?.field).toMatch(/procedureName/);
    });

    it(
      'crea el registro, da de alta el procedimiento en el catalogo y actualiza lastActivityAt del ingreso; ' +
        'borrarlo lo revierte',
      async () => {
        const admin = await crearUsuarioConRol('ADMIN');

        const antes = await prisma.admission.findUniqueOrThrow({ where: { id: 5001 } });
        expect(antes.lastActivityAt?.toISOString()).toBe('2026-06-01T16:00:00.000Z');
        expect(await prisma.procedure.findUnique({ where: { code: 'ZE2E999' } })).toBeNull();

        const creado = await api()
          .post('/api/v1/service-records')
          .set('Authorization', `Bearer ${admin.token}`)
          .send({
            id: 9_000_005,
            admissionId: 5001,
            code: 'ze2e999',
            procedureName: 'Servicio sintetico E2E',
            quantity: 2,
            providedAt: '2026-06-01T20:00:00-05:00', // 2026-06-02T01:00:00.000Z
            areaCode: 'ZE2',
            area: 'AREA E2E',
            specialty: 'ESP E2E',
          });

        expect(creado.status).toBe(201);
        expect(creado.body.data).toMatchObject({
          id: 9_000_005,
          admissionId: 5001,
          code: 'ZE2E999',
          procedureName: 'Servicio sintetico E2E',
          quantity: 2,
        });

        const catalogo = await prisma.procedure.findUnique({ where: { code: 'ZE2E999' } });
        expect(catalogo).toMatchObject({ code: 'ZE2E999', name: 'Servicio sintetico E2E' });

        const despuesCrear = await prisma.admission.findUniqueOrThrow({ where: { id: 5001 } });
        expect(despuesCrear.lastActivityAt?.toISOString()).toBe('2026-06-02T01:00:00.000Z');

        // 409: id duplicado.
        const duplicado = await api()
          .post('/api/v1/service-records')
          .set('Authorization', `Bearer ${admin.token}`)
          .send({
            id: 9_000_005,
            admissionId: 5001,
            code: '902210',
            quantity: 1,
            providedAt: '2026-06-01T09:00:00-05:00',
            areaCode: 'X',
            area: 'X',
            specialty: 'X',
          });
        expect(duplicado.status).toBe(409);

        const borrado = await api()
          .delete('/api/v1/service-records/9000005')
          .set('Authorization', `Bearer ${admin.token}`);
        expect(borrado.status).toBe(204);

        const despuesBorrar = await prisma.admission.findUniqueOrThrow({ where: { id: 5001 } });
        expect(despuesBorrar.lastActivityAt?.toISOString()).toBe('2026-06-01T16:00:00.000Z');

        const getTrasBorrar = await api()
          .get('/api/v1/service-records/9000005')
          .set('Authorization', `Bearer ${admin.token}`);
        expect(getTrasBorrar.status).toBe(404);

        const delOtraVez = await api()
          .delete('/api/v1/service-records/9000005')
          .set('Authorization', `Bearer ${admin.token}`);
        expect(delOtraVez.status).toBe(404);
      },
    );
  });

  describe('PATCH /api/v1/service-records/:id', () => {
    it('edita cantidad y providedAt, recalcula lastActivityAt; `executed` responde 422', async () => {
      const admin = await crearUsuarioConRol('ADMIN');
      await prisma.serviceRecord.create({
        data: {
          id: 9_000_006,
          admissionId: 5001,
          code: '902210',
          quantity: 1,
          providedAt: new Date('2026-06-01T20:00:00.000Z'),
          areaCode: 'ZE2',
          area: 'AREA E2E',
          specialty: 'ESP E2E',
        },
      });

      const conExecuted = await api()
        .patch('/api/v1/service-records/9000006')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ executed: 'si' });
      expect(conExecuted.status).toBe(422);

      const editado = await api()
        .patch('/api/v1/service-records/9000006')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ quantity: 5, providedAt: '2026-06-07T08:00:00-05:00' });
      expect(editado.status).toBe(200);
      expect(editado.body.data).toMatchObject({ quantity: 5 });
      expect(editado.body.data.providedAt).toBe('2026-06-07T13:00:00.000Z');

      const admission = await prisma.admission.findUniqueOrThrow({ where: { id: 5001 } });
      expect(admission.lastActivityAt?.toISOString()).toBe('2026-06-07T13:00:00.000Z');

      await prisma.serviceRecord.delete({ where: { id: 9_000_006 } });
    });

    it('404 sobre un id inexistente', async () => {
      const admin = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .patch('/api/v1/service-records/9999999')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ quantity: 1 });
      expect(res.status).toBe(404);
    });

    it('403 sin data:manage', async () => {
      const analista = await crearUsuarioConRol('ANALISTA');
      const res = await api()
        .patch('/api/v1/service-records/1')
        .set('Authorization', `Bearer ${analista.token}`)
        .send({ quantity: 9 });
      expect(res.status).toBe(403);
    });
  });
});
