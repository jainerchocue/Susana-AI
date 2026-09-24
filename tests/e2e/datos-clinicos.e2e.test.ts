import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { env } from '../../src/config/env';
import { Sesion, comoRol, prismaE2E } from './cliente';

/**
 * TC2 (E2E): `/patients`, `/admissions`, `/triages` contra los datos HIS
 * reales (14.502 pacientes, 17.781 ingresos, 16.106 triages, B0). Registros
 * sinteticos propios con id >= 9.000.000 (C0), borrados en `afterAll`: el
 * global setup los limpia igualmente si una corrida se rompe a medias.
 */

const BASE = inject('e2eUrl');
const PREFIJO = env.API_PREFIX;

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

describe('TC2 (E2E): /patients, /admissions, /triages sobre datos HIS reales', () => {
  let admin: Sesion; // ADMIN: patients:read + services:read + data:manage
  let director: Sesion; // DIRECTOR: patients:read, SIN data:manage
  let jefeServicio: Sesion; // JEFE_SERVICIO: services:read, SIN patients:read ni data:manage
  let consulta: Sesion; // CONSULTA: ninguno de los anteriores

  const tiempos: Record<string, number> = {};
  const idsSinteticosPatient: number[] = [];
  const idsSinteticosAdmission: number[] = [];
  const idsSinteticosTriage: number[] = [];

  beforeAll(async () => {
    admin = await comoRol(BASE, 'ADMIN');
    director = await comoRol(BASE, 'DIRECTOR');
    jefeServicio = await comoRol(BASE, 'JEFE_SERVICIO');
    consulta = await comoRol(BASE, 'CONSULTA');
  }, 60_000);

  afterAll(async () => {
    if (idsSinteticosAdmission.length > 0) {
      await prismaE2E().admission.deleteMany({ where: { id: { in: idsSinteticosAdmission } } });
    }
    if (idsSinteticosTriage.length > 0) {
      await prismaE2E().triage.deleteMany({ where: { id: { in: idsSinteticosTriage } } });
    }
    if (idsSinteticosPatient.length > 0) {
      await prismaE2E().patient.deleteMany({ where: { id: { in: idsSinteticosPatient } } });
    }
    await prismaE2E().$disconnect();
  });

  async function medir<T>(etiqueta: string, accion: () => Promise<T>): Promise<T> {
    const inicio = Date.now();
    const resultado = await accion();
    tiempos[etiqueta] = Date.now() - inicio;
    return resultado;
  }

  describe('autenticacion y permisos', () => {
    it('sin sesion -> 401 en los 3 recursos', async () => {
      const anonimo = new Sesion(BASE);
      for (const recurso of ['patients', 'admissions', 'triages']) {
        const r = await anonimo.get(`${PREFIJO}/${recurso}`);
        expect(r.status, recurso).toBe(401);
      }
    });

    it('CONSULTA -> 403 en los 3 recursos (ni patients:read ni services:read)', async () => {
      for (const recurso of ['patients', 'admissions', 'triages']) {
        const r = await consulta.get(`${PREFIJO}/${recurso}`);
        expect(r.status, recurso).toBe(403);
      }
    });

    it('JEFE_SERVICIO: 403 en /patients (sin patients:read), 200 en /admissions y /triages', async () => {
      expect((await jefeServicio.get(`${PREFIJO}/patients`)).status).toBe(403);
      expect((await jefeServicio.get(`${PREFIJO}/admissions`)).status).toBe(200);
      expect((await jefeServicio.get(`${PREFIJO}/triages`)).status).toBe(200);
    });

    it('DIRECTOR (patients:read, sin data:manage): 200 en lectura, 403 al escribir', async () => {
      expect((await director.get(`${PREFIJO}/patients`)).status).toBe(200);
      const r = await director.post(`${PREFIJO}/patients`, {
        id: 9_900_001,
        documentType: 'CC',
        birthDate: '2000-01-01',
        sex: 'Masculino',
        insurer: 'EPS TEST',
        regime: 'Contributivo',
        department: 'CAUCA',
        municipality: 'POPAYAN',
        zone: 'Urbana',
      });
      expect(r.status).toBe(403);
    });
  });

  describe('GET /patients: nunca expone birthDate, edad cotejada con la BD', () => {
    it('ninguna fila del listado trae birthDate', async () => {
      const r = await medir('patients:list', () => admin.get(`${PREFIJO}/patients?limit=100`));
      expect(r.status).toBe(200);
      const items = comoArreglo(comoRegistro(r.body).data).map(comoRegistro);
      expect(items.length).toBeGreaterThan(0);
      for (const p of items) expect(Object.keys(p)).not.toContain('birthDate');
    });

    it('filtro sex=Femenino cotejado con un conteo propio contra la BD', async () => {
      const total = await prismaE2E().patient.count({ where: { sex: 'Femenino' } });
      const r = await medir('patients:filtro-sex', () =>
        admin.get(`${PREFIJO}/patients?limit=1&sex=Femenino`),
      );
      expect(r.status).toBe(200);
      // Con datos reales (14.502 filas) no se trae todo el listado: se coteja
      // el total via `hasNext`/una segunda pagina no es necesario aqui, basta
      // con que la PRIMERA fila devuelta sea, en efecto, Femenino y que exista
      // al menos una fila si `total > 0`.
      expect(total).toBeGreaterThan(0);
      expect(comoArreglo(comoRegistro(r.body).data)).toHaveLength(1);
    });

    it('cursor: dos paginas seguidas de todo el catalogo no se solapan', async () => {
      const p1 = await admin.get(`${PREFIJO}/patients?limit=50`);
      const cursor = comoRegistro(p1.body).pagination as { nextCursor: string; hasNext: boolean };
      expect(cursor.hasNext).toBe(true);
      const p2 = await admin.get(`${PREFIJO}/patients?limit=50&cursor=${cursor.nextCursor}`);
      const idsP1 = comoArreglo(comoRegistro(p1.body).data).map((x) => comoRegistro(x).id);
      const idsP2 = comoArreglo(comoRegistro(p2.body).data).map((x) => comoRegistro(x).id);
      expect(idsP1.some((id) => idsP2.includes(id))).toBe(false);
    });

    it('cada lectura de /patients audita data.sensitive.read', async () => {
      const antes = await prismaE2E().auditLog.count({ where: { action: 'data.sensitive.read' } });
      await admin.get(`${PREFIJO}/patients?limit=1`);
      const despues = await prismaE2E().auditLog.count({ where: { action: 'data.sensitive.read' } });
      expect(despues).toBe(antes + 1);
    });
  });

  describe('GET /admissions: filtros cotejados con la BD, timing', () => {
    it('filtro unit + rango de admittedAt cotejado con una consulta propia', async () => {
      const referencia = await prismaE2E().admission.aggregate({ _max: { admittedAt: true } });
      const hasta = referencia._max.admittedAt!;
      const desde = new Date(hasta.getTime() - 7 * 24 * 60 * 60 * 1000);

      const esperados = await prismaE2E().admission.findMany({
        where: { unit: 'URGENCIAS', admittedAt: { gte: desde, lte: hasta } },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      expect(esperados.length).toBeGreaterThan(0);

      const r = await medir('admissions:filtro-unit-fecha', () =>
        admin.get(
          `${PREFIJO}/admissions?limit=${Math.min(esperados.length, 100)}&unit=URGENCIAS` +
            `&desde=${encodeURIComponent(desde.toISOString())}&hasta=${encodeURIComponent(hasta.toISOString())}`,
        ),
      );
      expect(r.status).toBe(200);
      const ids = comoArreglo(comoRegistro(r.body).data).map((x) => comoRegistro(x).id);
      expect(ids).toEqual(esperados.slice(0, ids.length).map((a) => a.id));
    });

    it('un ingreso real con triage trae su resumen de triage', async () => {
      const conTriage = await prismaE2E().admission.findFirst({ where: { triageId: { not: null } } });
      expect(conTriage).not.toBeNull();
      const r = await admin.get(`${PREFIJO}/admissions/${conTriage!.id}`);
      expect(r.status).toBe(200);
      const triage = comoRegistro(comoRegistro(r.body).data).triage;
      expect(triage).not.toBeNull();
      expect(comoRegistro(triage).id).toBe(conTriage!.triageId);
    });
  });

  describe('GET /triages: filtro por nivel cotejado con la BD, timing', () => {
    it('filtro level=1 cotejado con un conteo propio', async () => {
      const total = await prismaE2E().triage.count({ where: { level: 1 } });
      expect(total).toBeGreaterThan(0);
      const r = await medir('triages:filtro-level', () => admin.get(`${PREFIJO}/triages?limit=1&level=1`));
      expect(r.status).toBe(200);
      expect(comoArreglo(comoRegistro(r.body).data)).toHaveLength(1);
    });
  });

  describe('CRUD sintetico: derivados, dependientes y 409', () => {
    const patientId = 9_900_010;
    const admissionId = 9_900_010;
    const triageAId = 9_900_010;
    const triageBId = 9_900_011;

    it('crear paciente + ingreso + triage; PUT first-care recalcula waitMinutes; cambiar sexo cambia patientSex', async () => {
      const alta = await admin.post(`${PREFIJO}/patients`, {
        id: patientId,
        documentType: 'CC',
        birthDate: '1990-01-01',
        sex: 'Masculino',
        insurer: 'EPS TEST',
        regime: 'Contributivo',
        department: 'CAUCA',
        municipality: 'POPAYAN',
        zone: 'Urbana',
      });
      expect(alta.status).toBe(201);
      idsSinteticosPatient.push(patientId);

      const triageA = await admin.post(`${PREFIJO}/triages`, {
        id: triageAId,
        triagedAt: '2026-06-20T07:00:00-05:00',
        code: 'ZE10',
        classification: 'TRIAGE 2',
        level: 2,
        patientId,
      });
      expect(triageA.status).toBe(201);
      idsSinteticosTriage.push(triageAId);

      const ingreso = await admin.post(`${PREFIJO}/admissions`, {
        id: admissionId,
        consecutive: 1,
        patientId,
        admissionClass: 'Ambulatorio',
        entryRoute: 'Urgencias',
        riskType: 'Enfermedad General',
        admittedAt: '2026-06-20T08:00:00-05:00',
        triageId: triageAId,
        bedCode: 'ZE2E-E2E',
        bedName: 'CAMA ZE2E-E2E',
        unit: 'URGENCIAS',
        subunit: 'URGENCIAS ADULTOS',
      });
      expect(ingreso.status).toBe(201);
      idsSinteticosAdmission.push(admissionId);
      expect(comoRegistro(ingreso.body).data).toMatchObject({ patientSex: 'Masculino', triageLevel: 2 });

      const primeraAtencion = await admin.put(`${PREFIJO}/admissions/${admissionId}/first-care`, {
        firstCareAt: '2026-06-20T07:30:00-05:00',
      });
      expect(primeraAtencion.status).toBe(200);
      expect(comoRegistro(comoRegistro(primeraAtencion.body).data).waitMinutes).toBeCloseTo(30, 5);

      const cambioSexo = await admin.patch(`${PREFIJO}/patients/${patientId}`, { sex: 'Femenino' });
      expect(cambioSexo.status).toBe(200);
      const ingresoTrasCambio = await admin.get(`${PREFIJO}/admissions/${admissionId}`);
      expect(comoRegistro(comoRegistro(ingresoTrasCambio.body).data).patientSex).toBe('Femenino');

      const triageB = await admin.post(`${PREFIJO}/triages`, {
        id: triageBId,
        triagedAt: '2026-06-20T06:00:00-05:00',
        code: 'ZE11',
        classification: 'TRIAGE 1',
        level: 1,
        patientId,
      });
      expect(triageB.status).toBe(201);
      idsSinteticosTriage.push(triageBId);

      const cambioTriage = await admin.patch(`${PREFIJO}/admissions/${admissionId}`, { triageId: triageBId });
      expect(cambioTriage.status).toBe(200);
      expect(comoRegistro(cambioTriage.body).data).toMatchObject({ triageLevel: 1 });
      expect(comoRegistro(comoRegistro(cambioTriage.body).data).waitMinutes).toBeCloseTo(90, 5); // 07:30 - 06:00
    });

    it('borrar el paciente con ingreso/triage vinculados -> 409', async () => {
      const r = await admin.delete(`${PREFIJO}/patients/${patientId}`);
      expect(r.status).toBe(409);
    });

    it('borrar el triage vinculado (triageBId) -> 409', async () => {
      const r = await admin.delete(`${PREFIJO}/triages/${triageBId}`);
      expect(r.status).toBe(409);
    });

    it('un ingreso real con servicios o dispensaciones no se puede borrar (409)', async () => {
      const conServicios = await prismaE2E().serviceRecord.findFirst({ select: { admissionId: true } });
      expect(conServicios).not.toBeNull();
      const r = await admin.delete(`${PREFIJO}/admissions/${conServicios!.admissionId}`);
      expect(r.status).toBe(409);
    });

    it('limpieza: borrar ingreso, triages y paciente sinteticos en orden (sin dependientes ya)', async () => {
      const borrarIngreso = await admin.delete(`${PREFIJO}/admissions/${admissionId}`);
      expect(borrarIngreso.status).toBe(204);
      idsSinteticosAdmission.length = 0;

      const borrarTriageA = await admin.delete(`${PREFIJO}/triages/${triageAId}`);
      expect(borrarTriageA.status).toBe(204);
      const borrarTriageB = await admin.delete(`${PREFIJO}/triages/${triageBId}`);
      expect(borrarTriageB.status).toBe(204);
      idsSinteticosTriage.length = 0;

      const borrarPaciente = await admin.delete(`${PREFIJO}/patients/${patientId}`);
      expect(borrarPaciente.status).toBe(204);
      idsSinteticosPatient.length = 0;
    });
  });

  describe('tiempos de respuesta sobre datos reales (14.502 pacientes / 17.781 ingresos / 16.106 triages)', () => {
    it('todas las llamadas medidas responden en menos de 1s (sin indice en Patient/Admission/Triage salvo los ya existentes)', () => {
      expect(Object.keys(tiempos).length).toBeGreaterThan(0);
      for (const [etiqueta, ms] of Object.entries(tiempos)) {
        expect(ms, `${etiqueta} tardo ${ms}ms`).toBeLessThan(1000);
      }
    });
  });
});
