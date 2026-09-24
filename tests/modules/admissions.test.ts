import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AUDIT } from '../../src/core/audit/audit';
import { recalcularDerivados } from '../../src/modules/his/his.derivados';
import { api, cargarFixturesHis, crearUsuarioConRol, getApp, limpiar, prisma, type UsuarioPrueba } from '../helpers';

/**
 * TC2: CRUD de `admissions`. Fixtures (6 ingresos, 5001-5006) + sinteticos
 * propios (id >= 9.000.000, C0). `cargarFixturesHis()` al final deja la BD
 * como se encontro sin importar que quede a medio borrar de un test roto.
 */
describe('Modulo de ingresos (TC2)', () => {
  let admin: UsuarioPrueba; // ADMIN: services:read + data:manage
  let jefeServicio: UsuarioPrueba; // JEFE_SERVICIO: services:read, SIN data:manage
  let consulta: UsuarioPrueba; // CONSULTA: ni services:read ni data:manage

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
      const r = await api().get('/api/v1/admissions');
      expect(r.status).toBe(401);
    });

    it('CONSULTA (sin services:read) -> 403', async () => {
      const r = await api().get('/api/v1/admissions').set('Authorization', auth(consulta));
      expect(r.status).toBe(403);
    });

    it('JEFE_SERVICIO (services:read, sin data:manage) lee pero no escribe', async () => {
      const lectura = await api().get('/api/v1/admissions').set('Authorization', auth(jefeServicio));
      expect(lectura.status).toBe(200);

      const escritura = await api()
        .post('/api/v1/admissions')
        .set('Authorization', auth(jefeServicio))
        .send({
          id: 9_100_099,
          consecutive: 1,
          patientId: 1001,
          admissionClass: 'Ambulatorio',
          entryRoute: 'Urgencias',
          riskType: 'Enfermedad General',
          admittedAt: '2026-06-15T08:00:00-05:00',
          bedCode: 'ZE2E-X',
          bedName: 'CAMA ZE2E-X',
          unit: 'URGENCIAS',
          subunit: 'URGENCIAS ADULTOS',
        });
      expect(escritura.status).toBe(403);
    });
  });

  describe('GET /admissions (listado): cursor y filtros cotejados con la BD', () => {
    it('devuelve los 6 ingresos del fixture, cada uno con su triage resumido', async () => {
      const r = await api().get('/api/v1/admissions?limit=100').set('Authorization', auth(admin));
      expect(r.status).toBe(200);
      const items = r.body.data as Array<Record<string, unknown>>;
      const fixture = items.filter((a) => (a.id as number) < 9_000_000);
      expect(fixture).toHaveLength(6);
      const conTriage = fixture.find((a) => a.id === 5001) as Record<string, unknown>;
      expect((conTriage.triage as Record<string, unknown>).level).toBe(1);
      const sinTriage = fixture.find((a) => a.id === 5002) as Record<string, unknown>;
      expect(sinTriage.triage).toBeNull();
    });

    it('filtro unit=PEDIATRIA cotejado con la BD', async () => {
      const esperados = await prisma.admission.findMany({
        where: { unit: 'PEDIATRIA', id: { lt: 9_000_000 } },
        select: { id: true },
      });
      const r = await api().get('/api/v1/admissions?limit=100&unit=PEDIATRIA').set('Authorization', auth(admin));
      const ids = (r.body.data as Array<{ id: number }>).map((x) => x.id).filter((id) => id < 9_000_000);
      expect(ids).toEqual(esperados.map((a) => a.id));
    });

    it('filtro patientId cotejado con la BD', async () => {
      const r = await api().get('/api/v1/admissions?limit=100&patientId=1003').set('Authorization', auth(admin));
      expect(r.status).toBe(200);
      const ids = (r.body.data as Array<{ id: number; patientId: number }>).map((x) => x.id);
      expect(ids).toEqual([5003]);
    });

    it('rango de admittedAt cotejado con la BD', async () => {
      const desde = '2026-06-03T00:00:00-05:00';
      const hasta = '2026-06-04T23:59:59-05:00';
      const esperados = await prisma.admission.findMany({
        where: { admittedAt: { gte: new Date(desde), lte: new Date(hasta) }, id: { lt: 9_000_000 } },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      const r = await api()
        .get(`/api/v1/admissions?limit=100&desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`)
        .set('Authorization', auth(admin));
      const ids = (r.body.data as Array<{ id: number }>).map((x) => x.id).sort((a, b) => a - b);
      expect(ids).toEqual(esperados.map((a) => a.id));
    });

    it('cursor: limit=2 pagina sin duplicar ni saltar', async () => {
      const p1 = await api().get('/api/v1/admissions?limit=2').set('Authorization', auth(admin));
      expect(p1.body.pagination.hasNext).toBe(true);
      const p2 = await api()
        .get(`/api/v1/admissions?limit=2&cursor=${p1.body.pagination.nextCursor}`)
        .set('Authorization', auth(admin));
      const idsP1 = (p1.body.data as Array<{ id: number }>).map((x) => x.id);
      const idsP2 = (p2.body.data as Array<{ id: number }>).map((x) => x.id);
      expect(idsP1.some((id) => idsP2.includes(id))).toBe(false);
    });

    it('parametro desconocido -> 422', async () => {
      const r = await api().get('/api/v1/admissions?bogus=1').set('Authorization', auth(admin));
      expect(r.status).toBe(422);
    });
  });

  describe('GET /admissions/:id', () => {
    it('existente -> 200 con derivados', async () => {
      const r = await api().get('/api/v1/admissions/5001').set('Authorization', auth(admin));
      expect(r.status).toBe(200);
      expect(r.body.data.waitMinutes).toBeGreaterThan(0);
      expect(r.body.data.firstCareAt).not.toBeNull();
    });

    it('inexistente -> 404', async () => {
      const r = await api().get('/api/v1/admissions/9999999').set('Authorization', auth(admin));
      expect(r.status).toBe(404);
    });
  });

  describe('POST /admissions', () => {
    const id = 9_100_001;
    afterEach(async () => {
      await prisma.admission.deleteMany({ where: { id } });
    });

    it('crea el ingreso, deriva virtualBed del nombre de cama y responde 201', async () => {
      const r = await api()
        .post('/api/v1/admissions')
        .set('Authorization', auth(admin))
        .send({
          id,
          consecutive: 1,
          patientId: 1001,
          admissionClass: 'Ambulatorio',
          entryRoute: 'Urgencias',
          riskType: 'Enfermedad General',
          admittedAt: '2026-06-15T08:00:00-05:00',
          bedCode: 'ZE2E-1',
          bedName: 'CAMA ZE2E-1 VIRTUAL URGENCIAS',
          unit: 'URGENCIAS',
          subunit: 'URGENCIAS ADULTOS',
        });
      expect(r.status).toBe(201);
      expect(r.body.data.virtualBed).toBe(true);
      // Snapshot del paciente (patientSex, etc.) llenado por recalcularDerivados.
      expect(r.body.data.patientSex).toBe('Masculino');

      const fila = await prisma.auditLog.findFirst({
        where: { action: AUDIT.registroCreado, targetType: 'admission' },
        orderBy: { createdAt: 'desc' },
      });
      expect((fila!.metadata as { id: number }).id).toBe(id);
    });

    it('bedName sin "VIRTUAL" -> virtualBed false', async () => {
      const r = await api()
        .post('/api/v1/admissions')
        .set('Authorization', auth(admin))
        .send({
          id,
          consecutive: 1,
          patientId: 1001,
          admissionClass: 'Ambulatorio',
          entryRoute: 'Urgencias',
          riskType: 'Enfermedad General',
          admittedAt: '2026-06-15T08:00:00-05:00',
          bedCode: 'ZE2E-2',
          bedName: 'CAMA ZE2E-2 URGENCIAS',
          unit: 'URGENCIAS',
          subunit: 'URGENCIAS ADULTOS',
        });
      expect(r.status).toBe(201);
      expect(r.body.data.virtualBed).toBe(false);
    });

    it('patientId inexistente -> error (FK), nunca 201', async () => {
      const r = await api()
        .post('/api/v1/admissions')
        .set('Authorization', auth(admin))
        .send({
          id,
          consecutive: 1,
          patientId: 8_888_888,
          admissionClass: 'Ambulatorio',
          entryRoute: 'Urgencias',
          riskType: 'Enfermedad General',
          admittedAt: '2026-06-15T08:00:00-05:00',
          bedCode: 'ZE2E-3',
          bedName: 'CAMA ZE2E-3',
          unit: 'URGENCIAS',
          subunit: 'URGENCIAS ADULTOS',
        });
      expect(r.status).not.toBe(201);
    });

    it('id duplicado -> 409', async () => {
      const cuerpo = {
        id,
        consecutive: 1,
        patientId: 1001,
        admissionClass: 'Ambulatorio',
        entryRoute: 'Urgencias',
        riskType: 'Enfermedad General',
        admittedAt: '2026-06-15T08:00:00-05:00',
        bedCode: 'ZE2E-4',
        bedName: 'CAMA ZE2E-4',
        unit: 'URGENCIAS',
        subunit: 'URGENCIAS ADULTOS',
      };
      const r1 = await api().post('/api/v1/admissions').set('Authorization', auth(admin)).send(cuerpo);
      expect(r1.status).toBe(201);
      const r2 = await api().post('/api/v1/admissions').set('Authorization', auth(admin)).send(cuerpo);
      expect(r2.status).toBe(409);
    });
  });

  describe('PATCH /admissions/:id: recalcula derivados', () => {
    const admissionId = 9_100_010;
    const triageAId = 9_100_010;
    const triageBId = 9_100_011;

    beforeAll(async () => {
      await prisma.triage.createMany({
        data: [
          { id: triageAId, triagedAt: new Date('2026-06-15T07:00:00-05:00'), code: 'ZE2E1', classification: 'TRIAGE 2', level: 2, patientId: 1001 },
          { id: triageBId, triagedAt: new Date('2026-06-15T06:30:00-05:00'), code: 'ZE2E2', classification: 'TRIAGE 1', level: 1, patientId: 1001 },
        ],
      });
      await prisma.admission.create({
        data: {
          id: admissionId,
          consecutive: 1,
          patientId: 1001,
          admissionClass: 'Ambulatorio',
          entryRoute: 'Urgencias',
          riskType: 'Enfermedad General',
          admittedAt: new Date('2026-06-15T08:00:00-05:00'),
          triageId: triageAId,
          firstCareAt: new Date('2026-06-15T08:10:00-05:00'),
          bedCode: 'ZE2E-10',
          bedName: 'CAMA ZE2E-10',
          unit: 'URGENCIAS',
          subunit: 'URGENCIAS ADULTOS',
          virtualBed: false,
        },
      });
      await recalcularDerivados(prisma, { admissionIds: [admissionId] });
    });

    afterAll(async () => {
      await prisma.admission.deleteMany({ where: { id: admissionId } });
      await prisma.triage.deleteMany({ where: { id: { in: [triageAId, triageBId] } } });
    });

    it('cambiar triageId cambia waitMinutes y triageLevel', async () => {
      const previo = await prisma.admission.findUniqueOrThrow({ where: { id: admissionId } });
      expect(previo.triageLevel).toBe(2);

      const r = await api()
        .patch(`/api/v1/admissions/${admissionId}`)
        .set('Authorization', auth(admin))
        .send({ triageId: triageBId });
      expect(r.status).toBe(200);
      expect(r.body.data.triageLevel).toBe(1);
      expect(r.body.data.waitMinutes).toBeCloseTo(100, 5); // firstCareAt 08:10 - triageB 06:30 = 100 min
      expect(r.body.data.waitMinutes).not.toBe(previo.waitMinutes);
    });

    it('limpiar triageId (null) resetea triageLevel y waitMinutes', async () => {
      const r = await api()
        .patch(`/api/v1/admissions/${admissionId}`)
        .set('Authorization', auth(admin))
        .send({ triageId: null });
      expect(r.status).toBe(200);
      expect(r.body.data.triageLevel).toBeNull();
      expect(r.body.data.waitMinutes).toBeNull();
      expect(r.body.data.triage).toBeNull();
    });

    it('cambiar admittedAt invalida la fecha de referencia (efecto observable: nuevo max)', async () => {
      const referenciaAntes = await api().get('/api/v1/dashboard/summary').set('Authorization', auth(admin));
      const nuevaFecha = '2027-01-01T08:00:00-05:00';
      const r = await api()
        .patch(`/api/v1/admissions/${admissionId}`)
        .set('Authorization', auth(admin))
        .send({ admittedAt: nuevaFecha });
      expect(r.status).toBe(200);

      const referenciaDespues = await api().get('/api/v1/dashboard/summary').set('Authorization', auth(admin));
      expect(referenciaDespues.body.data.datosHasta).not.toBe(referenciaAntes.body.data.datosHasta);
      expect(new Date(referenciaDespues.body.data.datosHasta).getTime()).toBe(new Date(nuevaFecha).getTime());

      // Deja la fecha de referencia como estaba para no afectar al resto de la suite.
      await api()
        .patch(`/api/v1/admissions/${admissionId}`)
        .set('Authorization', auth(admin))
        .send({ admittedAt: '2026-06-15T08:00:00-05:00' });
    });

    it('triageId ya usado por otro ingreso -> 409', async () => {
      const otroId = 9_100_012;
      await prisma.admission.create({
        data: {
          id: otroId,
          consecutive: 1,
          patientId: 1001,
          admissionClass: 'Ambulatorio',
          entryRoute: 'Urgencias',
          riskType: 'Enfermedad General',
          admittedAt: new Date('2026-06-16T08:00:00-05:00'),
          bedCode: 'ZE2E-11',
          bedName: 'CAMA ZE2E-11',
          unit: 'URGENCIAS',
          subunit: 'URGENCIAS ADULTOS',
          virtualBed: false,
        },
      });
      // `admissionId` ya no tiene triage (se limpio en el test anterior); se lo
      // reasigna a triageAId y luego se intenta reusarlo desde `otroId`.
      const asignar = await api()
        .patch(`/api/v1/admissions/${admissionId}`)
        .set('Authorization', auth(admin))
        .send({ triageId: triageAId });
      expect(asignar.status).toBe(200);

      const r = await api()
        .patch(`/api/v1/admissions/${otroId}`)
        .set('Authorization', auth(admin))
        .send({ triageId: triageAId });
      expect(r.status).toBe(409);

      await prisma.admission.deleteMany({ where: { id: otroId } });
    });

    it('sin campos -> 422', async () => {
      const r = await api().patch(`/api/v1/admissions/${admissionId}`).set('Authorization', auth(admin)).send({});
      expect(r.status).toBe(422);
    });
  });

  describe('PUT/DELETE /admissions/:id/first-care', () => {
    const admissionId = 9_100_020;
    const triageId = 9_100_020;

    beforeAll(async () => {
      await prisma.triage.create({
        data: {
          id: triageId,
          triagedAt: new Date('2026-06-15T07:00:00-05:00'),
          code: 'ZE2E3',
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
          admittedAt: new Date('2026-06-15T08:00:00-05:00'),
          triageId,
          bedCode: 'ZE2E-20',
          bedName: 'CAMA ZE2E-20',
          unit: 'URGENCIAS',
          subunit: 'URGENCIAS ADULTOS',
          virtualBed: false,
        },
      });
    });

    afterAll(async () => {
      await prisma.admission.deleteMany({ where: { id: admissionId } });
      await prisma.triage.deleteMany({ where: { id: triageId } });
    });

    it('PUT establece firstCareAt y recalcula waitMinutes', async () => {
      const r = await api()
        .put(`/api/v1/admissions/${admissionId}/first-care`)
        .set('Authorization', auth(admin))
        .send({ firstCareAt: '2026-06-15T07:30:00-05:00' });
      expect(r.status).toBe(200);
      expect(r.body.data.firstCareAt).toBe(new Date('2026-06-15T07:30:00-05:00').toISOString());
      expect(r.body.data.waitMinutes).toBeCloseTo(30, 5);
    });

    it('DELETE limpia firstCareAt y waitMinutes vuelve a null', async () => {
      const r = await api()
        .delete(`/api/v1/admissions/${admissionId}/first-care`)
        .set('Authorization', auth(admin));
      expect(r.status).toBe(200);
      expect(r.body.data.firstCareAt).toBeNull();
      expect(r.body.data.waitMinutes).toBeNull();
    });

    it('sin permiso data:manage -> 403', async () => {
      const r = await api()
        .put(`/api/v1/admissions/${admissionId}/first-care`)
        .set('Authorization', auth(jefeServicio))
        .send({ firstCareAt: '2026-06-15T07:30:00-05:00' });
      expect(r.status).toBe(403);
    });
  });

  describe('DELETE /admissions/:id', () => {
    it('con service records o dispensaciones -> 409', async () => {
      // Ingreso 5001 del fixture tiene servicios en Servicios.txt? El fixture
      // de servicios lo carga otra tarea (TC3): se construye el escenario a
      // mano con un ingreso y un registro de servicio sinteticos propios.
      const admissionId = 9_100_030;
      await prisma.admission.create({
        data: {
          id: admissionId,
          consecutive: 1,
          patientId: 1001,
          admissionClass: 'Ambulatorio',
          entryRoute: 'Urgencias',
          riskType: 'Enfermedad General',
          admittedAt: new Date('2026-06-17T08:00:00-05:00'),
          bedCode: 'ZE2E-30',
          bedName: 'CAMA ZE2E-30',
          unit: 'URGENCIAS',
          subunit: 'URGENCIAS ADULTOS',
          virtualBed: false,
        },
      });
      await prisma.procedure.upsert({
        where: { code: 'ZE2E01' },
        update: {},
        create: { code: 'ZE2E01', name: 'Procedimiento sintetico' },
      });
      await prisma.serviceRecord.create({
        data: {
          id: 9_100_030,
          admissionId,
          code: 'ZE2E01',
          quantity: 1,
          providedAt: new Date('2026-06-17T09:00:00-05:00'),
          areaCode: 'ZE2E',
          area: 'AREA SINTETICA',
          specialty: 'ESPECIALIDAD SINTETICA',
        },
      });

      const r = await api().delete(`/api/v1/admissions/${admissionId}`).set('Authorization', auth(admin));
      expect(r.status).toBe(409);

      await prisma.serviceRecord.deleteMany({ where: { admissionId } });
      await prisma.admission.deleteMany({ where: { id: admissionId } });
      await prisma.procedure.deleteMany({ where: { code: 'ZE2E01' } });
    });

    it('sin dependientes -> 204, y recalcula executed=desconocido en cirugias que lo referenciaban', async () => {
      const admissionId = 9_100_040;
      await prisma.admission.create({
        data: {
          id: admissionId,
          consecutive: 1,
          patientId: 1001,
          admissionClass: 'Ambulatorio',
          entryRoute: 'Urgencias',
          riskType: 'Enfermedad General',
          admittedAt: new Date('2026-06-18T08:00:00-05:00'),
          bedCode: 'ZE2E-40',
          bedName: 'CAMA ZE2E-40',
          unit: 'URGENCIAS',
          subunit: 'URGENCIAS ADULTOS',
          virtualBed: false,
        },
      });
      const cirugia = await prisma.surgerySchedule.create({
        data: {
          scheduleNumber: 'ZE2E-PROG-1',
          patientId: 1001,
          admissionId,
          procedureCode: 'ZE2E99',
          executed: 'no',
        },
      });

      const r = await api().delete(`/api/v1/admissions/${admissionId}`).set('Authorization', auth(admin));
      expect(r.status).toBe(204);

      const fila = await prisma.admission.findUnique({ where: { id: admissionId } });
      expect(fila).toBeNull();

      const cirugiaDespues = await prisma.surgerySchedule.findUniqueOrThrow({ where: { id: cirugia.id } });
      expect(cirugiaDespues.executed).toBe('desconocido');

      await prisma.surgerySchedule.deleteMany({ where: { id: cirugia.id } });
    });

    it('inexistente -> 404', async () => {
      const r = await api().delete('/api/v1/admissions/9999999').set('Authorization', auth(admin));
      expect(r.status).toBe(404);
    });
  });
});
