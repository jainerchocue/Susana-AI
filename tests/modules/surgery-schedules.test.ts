import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, cargarFixturesHis, crearUsuarioConRol, getApp, limpiar, prisma } from '../helpers';

/**
 * CRUD de `surgery-schedules` (his_surgery_schedules, ProgramacionCirugia.txt,
 * TC3), contra los fixtures de `tests/fixtures/his` (4 filas, una duplicada
 * exacta -> 3 programaciones tras el import, ver comentario de
 * `tests/modules/surgeries.test.ts`):
 *
 *   00001  paciente 1005  ingreso 5005 (en el extracto)      806104  -> 'si'
 *   00002  paciente 1006  ingreso 5006 (en el extracto)      999999  -> 'no'
 *   00003  paciente 1004  ingreso 9999 (fuera del extracto)  555555  -> 'desconocido'
 */
describe('CRUD de surgery-schedules (TC3)', () => {
  beforeAll(async () => {
    await getApp();
    await limpiar();
    await cargarFixturesHis();
  }, 30_000);

  afterAll(async () => {
    await prisma.surgerySchedule.deleteMany({ where: { scheduleNumber: { startsWith: 'ZE2E' } } });
    await prisma.serviceRecord.deleteMany({ where: { id: { gte: 9_000_000 } } });
    await prisma.procedure.deleteMany({ where: { code: { startsWith: 'ZE2E' } } });
    await limpiar();
    await prisma.$disconnect();
  });

  describe('GET /api/v1/surgery-schedules', () => {
    it('401 sin sesion; 403 sin surgeries:read (FARMACIA)', async () => {
      const sinSesion = await api().get('/api/v1/surgery-schedules');
      expect(sinSesion.status).toBe(401);

      const farmacia = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .get('/api/v1/surgery-schedules')
        .set('Authorization', `Bearer ${farmacia.token}`);
      expect(res.status).toBe(403);
    });

    it('filtra por scheduleNumber, admissionId, procedureCode y executed', async () => {
      const usuario = await crearUsuarioConRol('ANALISTA');

      const porNumero = await api()
        .get('/api/v1/surgery-schedules?scheduleNumber=00002')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(porNumero.body.data).toHaveLength(1);
      expect(porNumero.body.data[0]).toMatchObject({ scheduleNumber: '00002', admissionId: 5006, executed: 'no' });

      const porIngreso = await api()
        .get('/api/v1/surgery-schedules?admissionId=5005')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(porIngreso.body.data).toHaveLength(1);
      expect(porIngreso.body.data[0]).toMatchObject({ procedureCode: '806104', executed: 'si' });

      const porProcedimiento = await api()
        .get('/api/v1/surgery-schedules?procedureCode=555555')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(porProcedimiento.body.data).toHaveLength(1);
      expect(porProcedimiento.body.data[0]).toMatchObject({ scheduleNumber: '00003', executed: 'desconocido' });

      const porEjecutada = await api()
        .get('/api/v1/surgery-schedules?executed=si')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(porEjecutada.body.data).toHaveLength(1);
    });

    it('un query param desconocido responde 422', async () => {
      const usuario = await crearUsuarioConRol('ANALISTA');
      const res = await api()
        .get('/api/v1/surgery-schedules?x=1')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(422);
    });
  });

  describe('POST /api/v1/surgery-schedules', () => {
    it('401 sin sesion; 403 sin data:manage', async () => {
      const cuerpo = { scheduleNumber: 'ZE2E-0001', patientId: 9_000_001, admissionId: null, procedureCode: 'ZE2E01' };
      const sinSesion = await api().post('/api/v1/surgery-schedules').send(cuerpo);
      expect(sinSesion.status).toBe(401);

      const analista = await crearUsuarioConRol('ANALISTA');
      const sinPermiso = await api()
        .post('/api/v1/surgery-schedules')
        .set('Authorization', `Bearer ${analista.token}`)
        .send(cuerpo);
      expect(sinPermiso.status).toBe(403);
    });

    it('`executed` no se acepta en la entrada: 422 tanto en POST como en PATCH', async () => {
      const admin = await crearUsuarioConRol('ADMIN');
      const conExecuted = await api()
        .post('/api/v1/surgery-schedules')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          scheduleNumber: 'ZE2E-0002',
          patientId: 9_000_002,
          admissionId: null,
          procedureCode: 'ZE2E02',
          executed: 'si',
        });
      expect(conExecuted.status).toBe(422);

      const existente = await prisma.surgerySchedule.findFirstOrThrow({ where: { scheduleNumber: '00001' } });
      const patchConExecuted = await api()
        .patch(`/api/v1/surgery-schedules/${existente.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ executed: 'no' });
      expect(patchConExecuted.status).toBe(422);
    });

    it('sin ingreso (admissionId null): executed = "desconocido" de inmediato', async () => {
      const admin = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .post('/api/v1/surgery-schedules')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ scheduleNumber: 'ZE2E-0003', patientId: 9_000_003, admissionId: null, procedureCode: 'ze2e03' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        scheduleNumber: 'ZE2E-0003',
        patientId: 9_000_003,
        admissionId: null,
        procedureCode: 'ZE2E03',
        executed: 'desconocido',
      });
    });

    it('con ingreso pero sin service-record que la haga verificable: executed = "no"', async () => {
      const admin = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .post('/api/v1/surgery-schedules')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ scheduleNumber: 'ZE2E-0004', patientId: 9_000_004, admissionId: 5001, procedureCode: 'ZE2E04' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ admissionId: 5001, executed: 'no' });
    });

    it('con ingreso Y un service-record del mismo codigo: executed = "si"', async () => {
      const admin = await crearUsuarioConRol('ADMIN');
      // 806104 ya tiene un service-record para el ingreso 5005 (fixture OidS=5, OSTEOSINTESIS).
      const res = await api()
        .post('/api/v1/surgery-schedules')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ scheduleNumber: 'ZE2E-0005', patientId: 9_000_005, admissionId: 5005, procedureCode: '806104' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ admissionId: 5005, procedureCode: '806104', executed: 'si' });
    });

    it('409 con una tupla (scheduleNumber, patientId, admissionId, procedureCode) duplicada', async () => {
      const admin = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .post('/api/v1/surgery-schedules')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ scheduleNumber: '00001', patientId: 1005, admissionId: 5005, procedureCode: '806104' });
      expect(res.status).toBe(409);
    });
  });

  describe('PATCH/DELETE /api/v1/surgery-schedules/:id', () => {
    it('cambiar admissionId a null recalcula executed a "desconocido"; 404 sobre un id inexistente', async () => {
      const admin = await crearUsuarioConRol('ADMIN');
      const creada = await api()
        .post('/api/v1/surgery-schedules')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ scheduleNumber: 'ZE2E-0006', patientId: 9_000_006, admissionId: 5005, procedureCode: '806104' });
      expect(creada.body.data.executed).toBe('si');

      const editada = await api()
        .patch(`/api/v1/surgery-schedules/${creada.body.data.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ admissionId: null });
      expect(editada.status).toBe(200);
      expect(editada.body.data).toMatchObject({ admissionId: null, executed: 'desconocido' });

      const noExiste = await api()
        .patch('/api/v1/surgery-schedules/9999999')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ patientId: 1 });
      expect(noExiste.status).toBe(404);
    });

    it('403 sin data:manage; borra y luego 404 en GET/DELETE', async () => {
      const admin = await crearUsuarioConRol('ADMIN');
      const creada = await api()
        .post('/api/v1/surgery-schedules')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ scheduleNumber: 'ZE2E-0007', patientId: 9_000_007, admissionId: null, procedureCode: 'ZE2E07' });
      const id: number = creada.body.data.id;

      const analista = await crearUsuarioConRol('ANALISTA');
      const sinPermiso = await api()
        .delete(`/api/v1/surgery-schedules/${id}`)
        .set('Authorization', `Bearer ${analista.token}`);
      expect(sinPermiso.status).toBe(403);

      const borrado = await api()
        .delete(`/api/v1/surgery-schedules/${id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(borrado.status).toBe(204);

      const get = await api()
        .get(`/api/v1/surgery-schedules/${id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(get.status).toBe(404);

      const delOtraVez = await api()
        .delete(`/api/v1/surgery-schedules/${id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(delOtraVez.status).toBe(404);
    });
  });

  describe('Integracion con service-records: crear/borrar un service-record recalcula el executed de sus cirugias', () => {
    it('desconocido/no -> si al llegar el service-record; vuelve a "no" al borrarlo; lastActivityAt sigue el mismo ciclo', async () => {
      const admin = await crearUsuarioConRol('ADMIN');

      const antes = await prisma.admission.findUniqueOrThrow({ where: { id: 5001 } });
      const lastActivityAtOriginal = antes.lastActivityAt?.toISOString();

      const cirugia = await api()
        .post('/api/v1/surgery-schedules')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ scheduleNumber: 'ZE2E-0008', patientId: 9_000_008, admissionId: 5001, procedureCode: 'ZE2E999' });
      expect(cirugia.status).toBe(201);
      expect(cirugia.body.data.executed).toBe('no');
      const cirugiaId: number = cirugia.body.data.id;

      const servicio = await api()
        .post('/api/v1/service-records')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          id: 9_000_009,
          admissionId: 5001,
          code: 'ze2e999',
          procedureName: 'Cirugia sintetica E2E',
          quantity: 1,
          providedAt: '2026-06-08T09:00:00-05:00',
          areaCode: 'ZE2',
          area: 'AREA E2E',
          specialty: 'ESP E2E',
        });
      expect(servicio.status).toBe(201);

      const cirugiaTrasCrear = await api()
        .get(`/api/v1/surgery-schedules/${cirugiaId}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(cirugiaTrasCrear.body.data.executed).toBe('si');

      const admissionTrasCrear = await prisma.admission.findUniqueOrThrow({ where: { id: 5001 } });
      expect(admissionTrasCrear.lastActivityAt?.toISOString()).toBe('2026-06-08T14:00:00.000Z');

      await api()
        .delete('/api/v1/service-records/9000009')
        .set('Authorization', `Bearer ${admin.token}`);

      const cirugiaTrasBorrar = await api()
        .get(`/api/v1/surgery-schedules/${cirugiaId}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(cirugiaTrasBorrar.body.data.executed).toBe('no');

      const admissionTrasBorrar = await prisma.admission.findUniqueOrThrow({ where: { id: 5001 } });
      expect(admissionTrasBorrar.lastActivityAt?.toISOString()).toBe(lastActivityAtOriginal);

      await prisma.surgerySchedule.delete({ where: { id: cirugiaId } });
      await prisma.procedure.deleteMany({ where: { code: 'ZE2E999' } });
    });
  });
});
