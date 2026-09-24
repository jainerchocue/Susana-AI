import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AUDIT } from '../../src/core/audit/audit';
import { recalcularDerivados } from '../../src/modules/his/his.derivados';
import { api, cargarFixturesHis, crearUsuarioConRol, getApp, limpiar, prisma, type UsuarioPrueba } from '../helpers';

/**
 * TC2: CRUD de `triages`. Fixtures reales: 7001 (nivel 1, paciente 1001),
 * 7003 (nivel 2), 7004 (nivel 3), 7005 (nivel 4, sin ingreso que lo vincule).
 */
describe('Modulo de triages (TC2)', () => {
  let admin: UsuarioPrueba;
  let jefeServicio: UsuarioPrueba;
  let consulta: UsuarioPrueba;

  beforeAll(async () => {
    await getApp();
    await cargarFixturesHis();
    admin = await crearUsuarioConRol('ADMIN');
    jefeServicio = await crearUsuarioConRol('JEFE_SERVICIO');
    consulta = await crearUsuarioConRol('CONSULTA');
  }, 60_000);

  afterAll(async () => {
    await cargarFixturesHis();
    await limpiar();
    await prisma.$disconnect();
  });

  function auth(u: UsuarioPrueba) {
    return `Bearer ${u.token}`;
  }

  describe('autenticacion y permisos', () => {
    it('sin sesion -> 401', async () => {
      const r = await api().get('/api/v1/triages');
      expect(r.status).toBe(401);
    });

    it('CONSULTA (sin services:read) -> 403', async () => {
      const r = await api().get('/api/v1/triages').set('Authorization', auth(consulta));
      expect(r.status).toBe(403);
    });

    it('JEFE_SERVICIO lee pero no escribe', async () => {
      const lectura = await api().get('/api/v1/triages').set('Authorization', auth(jefeServicio));
      expect(lectura.status).toBe(200);
      const escritura = await api()
        .post('/api/v1/triages')
        .set('Authorization', auth(jefeServicio))
        .send({ id: 9_200_099, triagedAt: '2026-06-20T08:00:00-05:00', code: 'ZE99', classification: 'TRIAGE 5' });
      expect(escritura.status).toBe(403);
    });
  });

  describe('GET /triages (listado): filtros cotejados con la BD', () => {
    it('devuelve los 4 triages reales del fixture (7005 se salta al no tener ingreso, pero SI existe como triage)', async () => {
      const r = await api().get('/api/v1/triages?limit=100').set('Authorization', auth(admin));
      expect(r.status).toBe(200);
      const ids = (r.body.data as Array<{ id: number }>).map((x) => x.id).filter((id) => id < 9_000_000);
      expect(ids.sort((a, b) => a - b)).toEqual([7001, 7003, 7004, 7005]);
    });

    it('filtro level=1 cotejado con la BD', async () => {
      const esperados = await prisma.triage.findMany({ where: { level: 1, id: { lt: 9_000_000 } }, select: { id: true } });
      const r = await api().get('/api/v1/triages?limit=100&level=1').set('Authorization', auth(admin));
      const ids = (r.body.data as Array<{ id: number }>).map((x) => x.id).filter((id) => id < 9_000_000);
      expect(ids).toEqual(esperados.map((t) => t.id));
    });

    it('filtro patientId cotejado con la BD', async () => {
      const r = await api().get('/api/v1/triages?limit=100&patientId=1001').set('Authorization', auth(admin));
      const ids = (r.body.data as Array<{ id: number }>).map((x) => x.id);
      expect(ids).toEqual([7001]);
    });

    it('parametro desconocido -> 422', async () => {
      const r = await api().get('/api/v1/triages?bogus=1').set('Authorization', auth(admin));
      expect(r.status).toBe(422);
    });
  });

  describe('GET /triages/:id', () => {
    it('existente -> 200', async () => {
      const r = await api().get('/api/v1/triages/7001').set('Authorization', auth(admin));
      expect(r.status).toBe(200);
      expect(r.body.data.level).toBe(1);
    });

    it('inexistente -> 404', async () => {
      const r = await api().get('/api/v1/triages/9999999').set('Authorization', auth(admin));
      expect(r.status).toBe(404);
    });
  });

  describe('POST /triages', () => {
    const id = 9_200_001;
    afterEach(async () => {
      await prisma.triage.deleteMany({ where: { id } });
    });

    it('crea el triage -> 201', async () => {
      const r = await api()
        .post('/api/v1/triages')
        .set('Authorization', auth(admin))
        .send({
          id,
          triagedAt: '2026-06-20T08:00:00-05:00',
          code: 'ZE01',
          classification: 'TRIAGE 3 (AMARILLO)',
          level: 3,
          patientId: 1001,
          systolic: 120,
          diastolic: 80,
        });
      expect(r.status).toBe(201);
      expect(r.body.data.level).toBe(3);

      const fila = await prisma.auditLog.findFirst({
        where: { action: AUDIT.registroCreado, targetType: 'triage' },
        orderBy: { createdAt: 'desc' },
      });
      expect((fila!.metadata as { id: number }).id).toBe(id);
    });

    it('signo vital fuera de rango -> 422', async () => {
      const r = await api()
        .post('/api/v1/triages')
        .set('Authorization', auth(admin))
        .send({ id, triagedAt: '2026-06-20T08:00:00-05:00', code: 'ZE01', classification: 'X', heartRate: 5000 });
      expect(r.status).toBe(422);
    });

    it('id duplicado -> 409', async () => {
      const cuerpo = { id, triagedAt: '2026-06-20T08:00:00-05:00', code: 'ZE01', classification: 'X' };
      const r1 = await api().post('/api/v1/triages').set('Authorization', auth(admin)).send(cuerpo);
      expect(r1.status).toBe(201);
      const r2 = await api().post('/api/v1/triages').set('Authorization', auth(admin)).send(cuerpo);
      expect(r2.status).toBe(409);
    });
  });

  describe('PATCH /triages/:id: recalcula derivados del ingreso vinculado', () => {
    const triageId = 9_200_010;
    const admissionId = 9_200_010;

    beforeAll(async () => {
      await prisma.triage.create({
        data: {
          id: triageId,
          triagedAt: new Date('2026-06-20T07:00:00-05:00'),
          code: 'ZE10',
          classification: 'TRIAGE 2',
          level: 2,
          patientId: 1001,
        },
      });
      await prisma.admission.create({
        data: {
          id: admissionId,
          consecutive: 1,
          patientId: 1001,
          admissionClass: 'Ambulatorio',
          entryRoute: 'Urgencias',
          riskType: 'Enfermedad General',
          admittedAt: new Date('2026-06-20T08:00:00-05:00'),
          triageId,
          firstCareAt: new Date('2026-06-20T08:20:00-05:00'),
          bedCode: 'ZE2E-T10',
          bedName: 'CAMA ZE2E-T10',
          unit: 'URGENCIAS',
          subunit: 'URGENCIAS ADULTOS',
          virtualBed: false,
        },
      });
      await recalcularDerivados(prisma, { admissionIds: [admissionId] });
    });

    afterAll(async () => {
      await prisma.admission.deleteMany({ where: { id: admissionId } });
      await prisma.triage.deleteMany({ where: { id: triageId } });
    });

    it('cambiar triagedAt del triage cambia waitMinutes del ingreso vinculado', async () => {
      const previo = await prisma.admission.findUniqueOrThrow({ where: { id: admissionId } });
      expect(previo.waitMinutes).toBeCloseTo(80, 5); // 08:20 - 07:00

      const r = await api()
        .patch(`/api/v1/triages/${triageId}`)
        .set('Authorization', auth(admin))
        .send({ triagedAt: '2026-06-20T08:10:00-05:00' });
      expect(r.status).toBe(200);

      const actualizado = await prisma.admission.findUniqueOrThrow({ where: { id: admissionId } });
      expect(actualizado.waitMinutes).toBeCloseTo(10, 5); // 08:20 - 08:10
      expect(actualizado.waitMinutes).not.toBe(previo.waitMinutes);
    });

    it('cambiar level propaga a triageLevel del ingreso vinculado', async () => {
      const r = await api()
        .patch(`/api/v1/triages/${triageId}`)
        .set('Authorization', auth(admin))
        .send({ level: 4 });
      expect(r.status).toBe(200);
      const actualizado = await prisma.admission.findUniqueOrThrow({ where: { id: admissionId } });
      expect(actualizado.triageLevel).toBe(4);
    });

    it('sin campos -> 422', async () => {
      const r = await api().patch(`/api/v1/triages/${triageId}`).set('Authorization', auth(admin)).send({});
      expect(r.status).toBe(422);
    });

    it('inexistente -> 404', async () => {
      const r = await api().patch('/api/v1/triages/9999999').set('Authorization', auth(admin)).send({ level: 1 });
      expect(r.status).toBe(404);
    });
  });

  describe('DELETE /triages/:id', () => {
    it('con un ingreso vinculado (triageId) -> 409', async () => {
      // Triage 7001 del fixture lo referencia el ingreso 5001.
      const r = await api().delete('/api/v1/triages/7001').set('Authorization', auth(admin));
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('CONFLICT');
    });

    it('sin ingreso vinculado -> 204', async () => {
      // Triage 7005 del fixture no tiene ingreso (IdPaciente2=9999, fuera del extracto).
      const r = await api().delete('/api/v1/triages/7005').set('Authorization', auth(admin));
      expect(r.status).toBe(204);
      const fila = await prisma.triage.findUnique({ where: { id: 7005 } });
      expect(fila).toBeNull();
    });

    it('inexistente -> 404', async () => {
      const r = await api().delete('/api/v1/triages/9999999').set('Authorization', auth(admin));
      expect(r.status).toBe(404);
    });
  });
});
