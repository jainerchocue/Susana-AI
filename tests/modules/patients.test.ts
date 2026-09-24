import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUDIT } from '../../src/core/audit/audit';
import { calcularEdad } from '../../src/modules/patients/patients.mapper';
import { fechaReferencia } from '../../src/modules/his/his.periodo';
import { recalcularDerivados } from '../../src/modules/his/his.derivados';
import { api, cargarFixturesHis, crearUsuarioConRol, getApp, limpiar, prisma, type UsuarioPrueba } from '../helpers';

/**
 * TC2: CRUD de `patients`. Fixtures de `tests/fixtures/his` (6 pacientes,
 * 1001-1006, `cargarFixturesHis`) + registros sinteticos propios con
 * id >= 9.000.000 (C0), borrados al final para dejar la BD como se encontro.
 */
describe('Modulo de pacientes (TC2)', () => {
  let admin: UsuarioPrueba; // ADMIN: patients:read + data:manage
  let director: UsuarioPrueba; // DIRECTOR: patients:read, SIN data:manage
  let consulta: UsuarioPrueba; // CONSULTA: ni patients:read ni data:manage

  beforeAll(async () => {
    await getApp();
    await cargarFixturesHis();
    admin = await crearUsuarioConRol('ADMIN');
    director = await crearUsuarioConRol('DIRECTOR');
    consulta = await crearUsuarioConRol('CONSULTA');
  }, 60_000);

  afterAll(async () => {
    // `cargarFixturesHis()` vacia TODAS las tablas his_* y las vuelve a cargar
    // desde el fixture: deja la BD como se encontro sin importar que sinteticos
    // (id >= 9.000.000) hayan quedado de un test fallido a medias.
    await cargarFixturesHis();
    await limpiar();
    await prisma.$disconnect();
  });

  function auth(u: UsuarioPrueba) {
    return `Bearer ${u.token}`;
  }

  describe('autenticacion y permisos', () => {
    it('sin sesion -> 401', async () => {
      const r = await api().get('/api/v1/patients');
      expect(r.status).toBe(401);
    });

    it('CONSULTA (sin patients:read) -> 403', async () => {
      const r = await api().get('/api/v1/patients').set('Authorization', auth(consulta));
      expect(r.status).toBe(403);
    });

    it('DIRECTOR (patients:read, sin data:manage) puede leer pero no escribir', async () => {
      const lectura = await api().get('/api/v1/patients').set('Authorization', auth(director));
      expect(lectura.status).toBe(200);

      const escritura = await api()
        .post('/api/v1/patients')
        .set('Authorization', auth(director))
        .send({
          id: 9_000_099,
          documentType: 'CC',
          birthDate: '2000-01-01',
          sex: 'Masculino',
          insurer: 'EPS TEST',
          regime: 'Contributivo',
          department: 'CAUCA',
          municipality: 'POPAYAN',
          zone: 'Urbana',
        });
      expect(escritura.status).toBe(403);
    });
  });

  describe('GET /patients (listado): cursor y filtros cotejados con la BD', () => {
    it('devuelve los 6 pacientes del fixture, sin birthDate en ninguna fila', async () => {
      const r = await api().get('/api/v1/patients?limit=100').set('Authorization', auth(admin));
      expect(r.status).toBe(200);
      const items = r.body.data as Array<Record<string, unknown>>;
      const idsFixture = items.filter((p) => (p.id as number) < 9_000_000);
      expect(idsFixture).toHaveLength(6);
      for (const p of items) expect(Object.keys(p)).not.toContain('birthDate');
    });

    it('cursor: limit=2 pagina en dos vueltas sin duplicar ni saltar filas', async () => {
      const p1 = await api().get('/api/v1/patients?limit=2').set('Authorization', auth(admin));
      expect(p1.status).toBe(200);
      expect(p1.body.data).toHaveLength(2);
      expect(p1.body.pagination.hasNext).toBe(true);
      const cursor = p1.body.pagination.nextCursor as string;

      const p2 = await api()
        .get(`/api/v1/patients?limit=2&cursor=${cursor}`)
        .set('Authorization', auth(admin));
      expect(p2.status).toBe(200);
      const idsP1 = (p1.body.data as Array<{ id: number }>).map((x) => x.id);
      const idsP2 = (p2.body.data as Array<{ id: number }>).map((x) => x.id);
      expect(new Set([...idsP1, ...idsP2]).size).toBe(4);
      expect(idsP1.some((id) => idsP2.includes(id))).toBe(false);
    });

    it('filtro sex=Masculino cotejado con una consulta propia a la BD', async () => {
      const esperados = await prisma.patient.findMany({
        where: { sex: 'Masculino', id: { lt: 9_000_000 } },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      const r = await api().get('/api/v1/patients?limit=100&sex=Masculino').set('Authorization', auth(admin));
      expect(r.status).toBe(200);
      const ids = (r.body.data as Array<{ id: number }>).map((x) => x.id).filter((id) => id < 9_000_000);
      expect(ids.sort((a, b) => a - b)).toEqual(esperados.map((p) => p.id));
    });

    it('filtro zone=Rural cotejado con la BD', async () => {
      const esperados = await prisma.patient.findMany({
        where: { zone: 'Rural', id: { lt: 9_000_000 } },
        select: { id: true },
      });
      const r = await api().get('/api/v1/patients?limit=100&zone=Rural').set('Authorization', auth(admin));
      const ids = (r.body.data as Array<{ id: number }>).map((x) => x.id).filter((id) => id < 9_000_000);
      expect(ids).toEqual(esperados.map((p) => p.id));
    });

    it('rango de edad (minAge/maxAge) cotejado calculando la edad de cada fila de la BD', async () => {
      const referencia = await fechaReferencia();
      const todos = await prisma.patient.findMany({ where: { id: { lt: 9_000_000 } } });
      const esperados = todos
        .filter((p) => {
          const edad = calcularEdad(p.birthDate, referencia);
          return edad >= 30 && edad <= 40;
        })
        .map((p) => p.id)
        .sort((a, b) => a - b);
      expect(esperados.length).toBeGreaterThan(0);

      const r = await api()
        .get('/api/v1/patients?limit=100&minAge=30&maxAge=40')
        .set('Authorization', auth(admin));
      expect(r.status).toBe(200);
      const ids = (r.body.data as Array<{ id: number }>).map((x) => x.id).filter((id) => id < 9_000_000);
      expect(ids.sort((a, b) => a - b)).toEqual(esperados);
    });

    it('minAge > maxAge -> 422', async () => {
      const r = await api().get('/api/v1/patients?minAge=50&maxAge=10').set('Authorization', auth(admin));
      expect(r.status).toBe(422);
    });

    it('parametro desconocido -> 422 (.strict())', async () => {
      const r = await api().get('/api/v1/patients?bogus=1').set('Authorization', auth(admin));
      expect(r.status).toBe(422);
    });

    it('cada lectura del listado audita data.sensitive.read con filtros y n. de resultados', async () => {
      const antes = await prisma.auditLog.count({ where: { action: AUDIT.accesoSensible } });
      const r = await api().get('/api/v1/patients?sex=Femenino&limit=100').set('Authorization', auth(admin));
      expect(r.status).toBe(200);
      const despues = await prisma.auditLog.count({ where: { action: AUDIT.accesoSensible } });
      expect(despues).toBe(antes + 1);

      const fila = await prisma.auditLog.findFirst({
        where: { action: AUDIT.accesoSensible, targetType: 'patient' },
        orderBy: { createdAt: 'desc' },
      });
      expect(fila).not.toBeNull();
      const meta = fila!.metadata as { filtros: { sex: string | null }; resultados: number };
      expect(meta.filtros.sex).toBe('Femenino');
      expect(meta.resultados).toBe((r.body.data as unknown[]).length);
    });
  });

  describe('GET /patients/:id', () => {
    it('paciente existente -> 200, sin birthDate, con age numerico', async () => {
      const r = await api().get('/api/v1/patients/1001').set('Authorization', auth(admin));
      expect(r.status).toBe(200);
      expect(r.body.data.id).toBe(1001);
      expect(Object.keys(r.body.data)).not.toContain('birthDate');
      expect(typeof r.body.data.age).toBe('number');
    });

    it('inexistente -> 404', async () => {
      const r = await api().get('/api/v1/patients/9999999').set('Authorization', auth(admin));
      expect(r.status).toBe(404);
    });

    it('audita data.sensitive.read con el id (nunca datos clinicos) en metadata', async () => {
      const r = await api().get('/api/v1/patients/1002').set('Authorization', auth(admin));
      expect(r.status).toBe(200);
      const fila = await prisma.auditLog.findFirst({
        where: { action: AUDIT.accesoSensible, targetType: 'patient' },
        orderBy: { createdAt: 'desc' },
      });
      expect((fila!.metadata as { id: number }).id).toBe(1002);
    });
  });

  describe('POST /patients', () => {
    const nuevo = {
      id: 9_000_001,
      documentType: 'CC',
      birthDate: '1999-05-20',
      sex: 'Femenino',
      insurer: 'EPS SURA',
      regime: 'Contributivo',
      department: 'CAUCA',
      municipality: 'POPAYAN',
      zone: 'Urbana',
    };

    afterAll(async () => {
      await prisma.patient.deleteMany({ where: { id: nuevo.id } });
    });

    it('crea el paciente -> 201, respuesta sin birthDate', async () => {
      const r = await api().post('/api/v1/patients').set('Authorization', auth(admin)).send(nuevo);
      expect(r.status).toBe(201);
      expect(r.body.data.id).toBe(nuevo.id);
      expect(Object.keys(r.body.data)).not.toContain('birthDate');

      const fila = await prisma.auditLog.findFirst({
        where: { action: AUDIT.registroCreado, targetType: 'patient' },
        orderBy: { createdAt: 'desc' },
      });
      expect((fila!.metadata as { id: number }).id).toBe(nuevo.id);
    });

    it('id duplicado -> 409', async () => {
      const r = await api().post('/api/v1/patients').set('Authorization', auth(admin)).send(nuevo);
      expect(r.status).toBe(409);
    });

    it('campo extra -> 422 (.strict())', async () => {
      const r = await api()
        .post('/api/v1/patients')
        .set('Authorization', auth(admin))
        .send({ ...nuevo, id: 9_000_002, extra: 'no' });
      expect(r.status).toBe(422);
    });
  });

  describe('PATCH /patients/:id: recalcula derivados en sus ingresos', () => {
    const patientId = 9_000_010;
    const admissionId = 9_000_010;

    beforeAll(async () => {
      await prisma.patient.create({
        data: {
          id: patientId,
          documentType: 'CC',
          birthDate: new Date('1990-01-01T00:00:00.000Z'),
          sex: 'Masculino',
          insurer: 'EPS TEST',
          regime: 'Contributivo',
          department: 'CAUCA',
          municipality: 'POPAYAN',
          zone: 'Urbana',
        },
      });
      await prisma.admission.create({
        data: {
          id: admissionId,
          consecutive: 1,
          patientId,
          admissionClass: 'Ambulatorio',
          entryRoute: 'Urgencias',
          riskType: 'Enfermedad General',
          admittedAt: new Date('2026-06-10T08:00:00-05:00'),
          bedCode: 'ZE2E-1',
          bedName: 'CAMA ZE2E-1',
          unit: 'URGENCIAS',
          subunit: 'URGENCIAS ADULTOS',
          virtualBed: false,
        },
      });
      // Los inserts directos por Prisma no pasan por el CRUD: se llena el
      // snapshot inicial (patientSex/Regime/Zone/Age) a mano, igual que haria
      // el importador tras la carga.
      await recalcularDerivados(prisma, { admissionIds: [admissionId] });
    });

    afterAll(async () => {
      await prisma.admission.deleteMany({ where: { id: admissionId } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
    });

    it('cambiar el sexo del paciente cambia patientSex en sus ingresos', async () => {
      const previo = await prisma.admission.findUniqueOrThrow({ where: { id: admissionId } });
      expect(previo.patientSex).toBe('Masculino');

      const r = await api()
        .patch(`/api/v1/patients/${patientId}`)
        .set('Authorization', auth(admin))
        .send({ sex: 'Femenino' });
      expect(r.status).toBe(200);
      expect(r.body.data.sex).toBe('Femenino');

      const actualizado = await prisma.admission.findUniqueOrThrow({ where: { id: admissionId } });
      expect(actualizado.patientSex).toBe('Femenino');
    });

    it('sin campos -> 422', async () => {
      const r = await api().patch(`/api/v1/patients/${patientId}`).set('Authorization', auth(admin)).send({});
      expect(r.status).toBe(422);
    });

    it('inexistente -> 404', async () => {
      const r = await api()
        .patch('/api/v1/patients/9999999')
        .set('Authorization', auth(admin))
        .send({ sex: 'Femenino' });
      expect(r.status).toBe(404);
    });
  });

  describe('DELETE /patients/:id', () => {
    it('con ingresos o triages que lo referencian -> 409', async () => {
      // Paciente 1001 del fixture tiene un ingreso (5001) y un triage (7001).
      const r = await api().delete('/api/v1/patients/1001').set('Authorization', auth(admin));
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('CONFLICT');
    });

    it('sin dependientes -> 204 y borrado real', async () => {
      const id = 9_000_020;
      await prisma.patient.create({
        data: {
          id,
          documentType: 'CC',
          birthDate: new Date('1990-01-01T00:00:00.000Z'),
          sex: 'Masculino',
          insurer: 'EPS TEST',
          regime: 'Contributivo',
          department: 'CAUCA',
          municipality: 'POPAYAN',
          zone: 'Urbana',
        },
      });

      const r = await api().delete(`/api/v1/patients/${id}`).set('Authorization', auth(admin));
      expect(r.status).toBe(204);
      const fila = await prisma.patient.findUnique({ where: { id } });
      expect(fila).toBeNull();
    });

    it('inexistente -> 404', async () => {
      const r = await api().delete('/api/v1/patients/9999999').set('Authorization', auth(admin));
      expect(r.status).toBe(404);
    });
  });
});
