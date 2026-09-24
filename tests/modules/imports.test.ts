import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { importarTabla, parsearCsvTexto } from '../../src/modules/his/his.import';
import { _reiniciarCandadoParaTests } from '../../src/modules/imports/imports.service';
import { api, crearUsuarioConRol, getApp, prisma } from '../helpers';

/**
 * `POST /imports/:table` y compañia (TC1). Fixtures propios en
 * `tests/fixtures/imports/` (comas+comillas para probar el parser RFC 4180,
 * y un par en formato nativo `|`/`;` para probar la deteccion de separador).
 * Ids/codigos sinteticos >= 9.000.000 / prefijo `ZE2E` (convencion de C0):
 * no colisionan con los fixtures de `tests/fixtures/his` (ids 1000-9999) que
 * usa `his-import.test.ts` en la MISMA base de datos (`hospital_test_f`).
 *
 * Corre contra `hospital_test_f` (ver DATABASE_URL de la tarea).
 */

const DIR = path.join(__dirname, '../fixtures/imports');
const IMPORTS = '/api/v1/imports';

function leer(nombre: string): string {
  return fs.readFileSync(path.join(DIR, nombre), 'utf-8');
}

async function esperarJobTerminado(token: string, id: string, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  const desde = Date.now();
  for (;;) {
    const res = await api().get(`${IMPORTS}/${id}`).set('Authorization', `Bearer ${token}`);
    const job = res.body.data as { status: string };
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return res.body.data as Record<string, unknown>;
    if (Date.now() - desde > timeoutMs) throw new Error(`El job ${id} no termino en ${timeoutMs}ms (status=${job.status})`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function subir(token: string, tabla: string, contenido: string, fileName?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const query = fileName ? `?fileName=${encodeURIComponent(fileName)}` : '';
  const res = await api()
    .post(`${IMPORTS}/${tabla}${query}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'text/csv')
    .send(contenido);
  return { status: res.status, body: res.body };
}

/** Limpia todo lo sintetico que puedan dejar estos tests (id/patientId/code >= 9.000.000 o prefijo ZE2E/DME2E). */
async function limpiarSintetico(): Promise<void> {
  const filtroSintetico = {
    OR: [{ id: { gte: 9_000_000 } }, { admissionId: { gte: 9_000_000 } }, { code: { startsWith: 'ZE2E' } }, { code: { startsWith: 'DME2E' } }],
  };
  await prisma.serviceRecord.deleteMany({ where: filtroSintetico });
  await prisma.medicationDispense.deleteMany({ where: filtroSintetico });
  await prisma.surgerySchedule.deleteMany({
    where: {
      OR: [
        { id: { gte: 9_000_000 } },
        { admissionId: { gte: 9_000_000 } },
        { patientId: { gte: 9_000_000 } },
        { procedureCode: { startsWith: 'ZE2E' } },
        { scheduleNumber: { startsWith: 'ZE2E' } },
      ],
    },
  });
  await prisma.admission.deleteMany({ where: { OR: [{ id: { gte: 9_000_000 } }, { patientId: { gte: 9_000_000 } }] } });
  await prisma.triage.deleteMany({ where: { OR: [{ id: { gte: 9_000_000 } }, { patientId: { gte: 9_000_000 } }] } });
  await prisma.patient.deleteMany({ where: { id: { gte: 9_000_000 } } });
  await prisma.procedure.deleteMany({ where: { code: { startsWith: 'ZE2E' } } });
  await prisma.medication.deleteMany({ where: { code: { startsWith: 'ZE2E' } } });
  await prisma.medication.deleteMany({ where: { code: { startsWith: 'DME2E' } } });
  await prisma.importJob.deleteMany();
}

describe('Modulo de imports (TC1)', () => {
  let admin: { token: string };
  let analista: { token: string };

  beforeAll(async () => {
    await getApp();
    await limpiarSintetico();
    admin = await crearUsuarioConRol('ADMIN');
    analista = await crearUsuarioConRol('ANALISTA');
  }, 30_000);

  afterAll(async () => {
    await limpiarSintetico();
    await prisma.$disconnect();
  });

  describe('parser RFC 4180 (parsearCsvTexto, sin tocar disco)', () => {
    it('separa por coma respetando comillas', () => {
      expect(parsearCsvTexto('a,b,c\n1,"2,2",3\n', ',')).toEqual([
        ['a', 'b', 'c'],
        ['1', '2,2', '3'],
      ]);
    });

    it('desescapa comillas dobles dentro de un campo citado', () => {
      expect(parsearCsvTexto('"a""b",c\n', ',')).toEqual([['a"b', 'c']]);
    });

    it('un campo citado puede contener un salto de linea', () => {
      expect(parsearCsvTexto('x,"linea1\nlinea2",y\n', ',')).toEqual([['x', 'linea1\nlinea2', 'y']]);
    });

    it('separa por punto y coma', () => {
      expect(parsearCsvTexto('a;b\n1;2\n', ';')).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ]);
    });

    it('la ultima fila sin salto de linea final tambien se emite', () => {
      expect(parsearCsvTexto('a,b\n1,2', ',')).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ]);
    });

    it('CRLF se trata como un solo salto de fila', () => {
      expect(parsearCsvTexto('a,b\r\n1,2\r\n', ',')).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ]);
    });
  });

  describe('importarTabla directo, con lotes pequeños (tamanoLote=2)', () => {
    it('6 pacientes en 3 lotes de 2: los inserta todos, sin perder ninguno en el borde del lote', async () => {
      const resumen = await importarTabla('patients', path.join(DIR, 'patients-lote.csv'), { tamanoLote: 2 });
      expect(resumen).toMatchObject({ table: 'patients', procesadas: 6, insertadas: 6, invalidas: 0 });

      const ids = [9_000_401, 9_000_402, 9_000_403, 9_000_404, 9_000_405, 9_000_406];
      const contados = await prisma.patient.count({ where: { id: { in: ids } } });
      expect(contados).toBe(6);
    });
  });

  describe('401/403', () => {
    it('401 sin sesion', async () => {
      const res = await api().get(IMPORTS);
      expect(res.status).toBe(401);
    });

    it('403 para ANALISTA (no tiene data:import)', async () => {
      const res = await api().get(IMPORTS).set('Authorization', `Bearer ${analista.token}`);
      expect(res.status).toBe(403);
    });

    it('403 al intentar subir sin data:import', async () => {
      const r = await subir(analista.token, 'patients', leer('patients.csv'));
      expect(r.status).toBe(403);
    });
  });

  describe('415: content-type distinto de text/csv en POST /imports/:table', () => {
    it('rechaza application/json', async () => {
      const res = await api()
        .post(`${IMPORTS}/patients`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('Content-Type', 'application/json')
        .send({ foo: 'bar' });
      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });
  });

  describe('413: archivo por encima de IMPORT_MAX_MB', () => {
    const original = env.IMPORT_MAX_MB;

    afterAll(() => {
      // `env` es un singleton mutable en memoria (Zod no lo congela): se
      // restaura el valor real para no afectar al resto de la suite.
      env.IMPORT_MAX_MB = original;
    });

    it('corta la subida con 413 si el cuerpo supera el limite', async () => {
      env.IMPORT_MAX_MB = 0; // 0 MB: cualquier byte del cuerpo ya excede el limite.
      const r = await subir(admin.token, 'patients', leer('patients.csv'));
      expect(r.status).toBe(413);
      expect((r.body.error as { code: string }).code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('409: un solo trabajo RUNNING/PENDING a la vez', () => {
    it('la segunda subida concurrente es rechazada mientras la primera esta en curso', async () => {
      // Fixtures EXCLUSIVOS de este test (ids 9.000.501/502): si se reutilizara
      // aqui un archivo que otro test tambien sube mas adelante, quien gane la
      // carrera lo dejaria ya importado y ese test posterior veria
      // "duplicadas" en vez de "insertadas" de forma no determinista.
      _reiniciarCandadoParaTests();
      const [r1, r2] = await Promise.all([
        subir(admin.token, 'patients', leer('patients-concurrencia-a.csv')),
        subir(admin.token, 'patients', leer('patients-concurrencia-b.csv')),
      ]);
      const estados = [r1.status, r2.status].sort((a, b) => a - b);
      expect(estados).toEqual([202, 409]);

      const ganador = r1.status === 202 ? r1 : r2;
      const job = await esperarJobTerminado(admin.token, (ganador.body.data as { id: string }).id);
      expect(job.status).toBe('COMPLETED');
    });
  });

  describe('cabecera erronea -> job FAILED con el mensaje', () => {
    it('admissions con una columna mal escrita termina FAILED', async () => {
      const r = await subir(admin.token, 'admissions', leer('cabecera-mala.txt'), 'cabecera-mala.txt');
      expect(r.status).toBe(202);
      const job = await esperarJobTerminado(admin.token, (r.body.data as { id: string }).id);
      expect(job.status).toBe('FAILED');
      expect(String(job.message)).toMatch(/Cabecera invalida/);
    });
  });

  describe('camino feliz: las 7 tablas, en orden, con CSV de comas y comillas', () => {
    it('patients: 3 procesadas, 3 insertadas, delimitador coma', async () => {
      const r = await subir(admin.token, 'patients', leer('patients.csv'));
      expect(r.status).toBe(202);
      const job = await esperarJobTerminado(admin.token, (r.body.data as { id: string }).id);
      expect(job).toMatchObject({ status: 'COMPLETED', delimiter: ',', processed: 3, inserted: 3, invalid: 0 });

      const paciente = await prisma.patient.findUniqueOrThrow({ where: { id: 9_000_001 } });
      // La coma dentro de comillas ("EPS SURA, REGIONAL SUR") debe llegar intacta.
      expect(paciente.insurer).toBe('EPS SURA, REGIONAL SUR');
    });

    it('triages: 2 procesados, 2 insertados', async () => {
      const r = await subir(admin.token, 'triages', leer('triages.csv'));
      const job = await esperarJobTerminado(admin.token, (r.body.data as { id: string }).id);
      expect(job).toMatchObject({ status: 'COMPLETED', processed: 2, inserted: 2, invalid: 0 });

      const triage = await prisma.triage.findUniqueOrThrow({ where: { id: 9_000_001 } });
      expect(triage.level).toBe(2);
      expect(triage.patientId).toBe(9_000_001);
    });

    it('admissions: 3 procesados, 3 insertados, deriva triageLevel/patientAge', async () => {
      const r = await subir(admin.token, 'admissions', leer('admissions.csv'));
      const job = await esperarJobTerminado(admin.token, (r.body.data as { id: string }).id);
      expect(job).toMatchObject({ status: 'COMPLETED', processed: 3, inserted: 3, invalid: 0 });

      const a1 = await prisma.admission.findUniqueOrThrow({ where: { id: 9_000_001 } });
      expect(a1.triageId).toBe(9_000_001);
      expect(a1.triageLevel).toBe(2);
      expect(a1.patientSex).toBe('Masculino');
      // La coma dentro de comillas del diagnostico tambien debe llegar intacta.
      expect(a1.diagnosisName).toBe('FRACTURA, DESPLAZADA');
      expect(a1.virtualBed).toBe(false);

      const a2 = await prisma.admission.findUniqueOrThrow({ where: { id: 9_000_002 } });
      expect(a2.virtualBed).toBe(true);
    });

    it('first-care: registra firstCareAt y recalcula waitMinutes de los ingresos tocados', async () => {
      const r = await subir(admin.token, 'first-care', leer('first-care.csv'));
      const job = await esperarJobTerminado(admin.token, (r.body.data as { id: string }).id);
      expect(job).toMatchObject({ status: 'COMPLETED', processed: 2, inserted: 2, invalid: 0 });

      const a1 = await prisma.admission.findUniqueOrThrow({ where: { id: 9_000_001 } });
      expect(a1.firstCareAt?.toISOString()).toBe(new Date('2026-06-01T13:25:00.000Z').toISOString());
      // triage 07:50 -05:00 = 12:50 UTC; atencion 08:25 -05:00 = 13:25 UTC -> 35 min.
      expect(a1.waitMinutes).toBeCloseTo(35, 5);
    });

    it('service-records: da de alta el catalogo Procedure sobre la marcha (con comillas escapadas en el nombre)', async () => {
      const r = await subir(admin.token, 'service-records', leer('service-records.csv'));
      const job = await esperarJobTerminado(admin.token, (r.body.data as { id: string }).id);
      expect(job).toMatchObject({ status: 'COMPLETED', processed: 2, inserted: 2, invalid: 0 });

      const procedimiento = await prisma.procedure.findUniqueOrThrow({ where: { code: 'ZE2E001' } });
      expect(procedimiento.name).toBe('SERVICIO "ESPECIAL" DE PRUEBA');
    });

    it('dispenses: da de alta Medication con kind por prefijo DM', async () => {
      const r = await subir(admin.token, 'dispenses', leer('dispenses.csv'));
      const job = await esperarJobTerminado(admin.token, (r.body.data as { id: string }).id);
      expect(job).toMatchObject({ status: 'COMPLETED', processed: 2, inserted: 2, invalid: 0 });

      const medicamento = await prisma.medication.findUniqueOrThrow({ where: { code: 'ZE2E101' } });
      expect(medicamento.kind).toBe('medicamento');
      const insumo = await prisma.medication.findUniqueOrThrow({ where: { code: 'DME2E102' } });
      expect(insumo.kind).toBe('insumo');
    });

    it('surgery-schedules: executed se recalcula (si / desconocido)', async () => {
      const r = await subir(admin.token, 'surgery-schedules', leer('surgery-schedules.csv'));
      const job = await esperarJobTerminado(admin.token, (r.body.data as { id: string }).id);
      expect(job).toMatchObject({ status: 'COMPLETED', processed: 2, inserted: 2, invalid: 0 });

      const conIngreso = await prisma.surgerySchedule.findFirstOrThrow({ where: { scheduleNumber: 'ZE2E-PROG-0001' } });
      expect(conIngreso.executed).toBe('si');
      const sinIngreso = await prisma.surgerySchedule.findFirstOrThrow({ where: { scheduleNumber: 'ZE2E-PROG-0002' } });
      expect(sinIngreso.executed).toBe('desconocido');
    });

    // TC6 (arreglo pendiente #2): antes, la fila SIN ingreso (admissionId null,
    // "ZE2E-PROG-0002") se duplicaba en cada subida del mismo archivo: el
    // indice unico compuesto no la protege porque Postgres no iguala dos NULL.
    it('subir el MISMO archivo de surgery-schedules dos veces no duplica la fila sin ingreso (idempotente)', async () => {
      const antes = await prisma.surgerySchedule.count({
        where: { scheduleNumber: { in: ['ZE2E-PROG-0001', 'ZE2E-PROG-0002'] } },
      });
      expect(antes).toBe(2); // insertadas por el test anterior de esta misma suite.

      const r = await subir(admin.token, 'surgery-schedules', leer('surgery-schedules.csv'));
      const job = await esperarJobTerminado(admin.token, (r.body.data as { id: string }).id);
      expect(job).toMatchObject({ status: 'COMPLETED', processed: 2, inserted: 0, duplicates: 2, invalid: 0 });

      const despues = await prisma.surgerySchedule.count({
        where: { scheduleNumber: { in: ['ZE2E-PROG-0001', 'ZE2E-PROG-0002'] } },
      });
      expect(despues).toBe(antes);

      const sinIngreso = await prisma.surgerySchedule.findMany({ where: { scheduleNumber: 'ZE2E-PROG-0002' } });
      expect(sinIngreso).toHaveLength(1);
    });
  });

  // TC6 (arreglo pendiente #3): la importacion por API rechazaba la fila cuyo
  // `IdPaciente2` no existe; la carga por CLI (B0) la acepta con `patientId:
  // null` y un aviso. Ahora las dos rutas son coherentes.
  describe('triages: paciente huerfano se acepta con patientId null + aviso (coherente con la carga CLI)', () => {
    it('triages-huerfano: 1 procesada, 1 insertada, 0 invalidas, 1 aviso contado en warnings', async () => {
      const r = await subir(admin.token, 'triages', leer('triages-huerfano.csv'));
      const job = await esperarJobTerminado(admin.token, (r.body.data as { id: string }).id);
      expect(job).toMatchObject({ status: 'COMPLETED', processed: 1, inserted: 1, invalid: 0, warnings: 1 });

      const triage = await prisma.triage.findUniqueOrThrow({ where: { id: 9_000_003 } });
      expect(triage.patientId).toBeNull();
    });
  });

  describe('FK huerfanas (formato nativo |): filas invalidas con motivo, sin romper el lote', () => {
    it('admissions-huerfano: 1 valida + 1 invalida por paciente inexistente', async () => {
      const r = await subir(admin.token, 'admissions', leer('admissions-huerfano.txt'));
      const job = await esperarJobTerminado(admin.token, (r.body.data as { id: string }).id);
      expect(job).toMatchObject({ status: 'COMPLETED', delimiter: '|', processed: 2, inserted: 1, invalid: 1 });

      const errores = job.errors as Array<{ linea: number; motivo: string }>;
      expect(errores).toHaveLength(1);
      expect(errores[0]?.motivo).toMatch(/paciente 9999999 no encontrado/);

      expect(await prisma.admission.findUnique({ where: { id: 9_000_201 } })).not.toBeNull();
      expect(await prisma.admission.findUnique({ where: { id: 9_000_202 } })).toBeNull();
    });
  });

  describe('separador ; detectado por la cabecera', () => {
    it('patients-semicolon: 2 procesados, delimitador ;', async () => {
      const r = await subir(admin.token, 'patients', leer('patients-semicolon.csv'));
      const job = await esperarJobTerminado(admin.token, (r.body.data as { id: string }).id);
      expect(job).toMatchObject({ status: 'COMPLETED', delimiter: ';', processed: 2, inserted: 2, invalid: 0 });
    });
  });

  describe('GET /imports (listado con filtros) y GET /imports/{id}', () => {
    it('filtra por table y status', async () => {
      const res = await api()
        .get(`${IMPORTS}?table=patients&status=COMPLETED&limit=100`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      const items = res.body.data as Array<{ table: string; status: string }>;
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) expect(item).toMatchObject({ table: 'patients', status: 'COMPLETED' });
    });

    it('404 con un id que no existe', async () => {
      const res = await api()
        .get(`${IMPORTS}/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /imports/templates/:table', () => {
    it('responde text/csv con la cabecera exacta de admissions', async () => {
      const res = await api()
        .get(`${IMPORTS}/templates/admissions`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      const primeraLinea = (res.text).split('\r\n')[0];
      expect(primeraLinea).toBe(
        '"OidIngreso","ConsecutivoIngreso","IdPaciente","ClaseIngreso","ViaIngreso","TipoRiesgo","FechaIngreso","FechaHospitalizacion","OidTriageA","CodigoCama","NombreCama","NombreGrupoCama","NombreSubgrupoCama","CodigoDiagnostico","NombreDiagnostico"',
      );
    });
  });

  describe('DELETE /imports/{id}', () => {
    it('409 si el trabajo esta en curso, 204 y desaparece si ya termino', async () => {
      const r = await subir(admin.token, 'patients', 'TipoDocumento,IdPaciente,NombrePaciente,FechaNacimiento,Sexo,Asegurador,Regimen,Departamento,Municipio,Zona\n');
      const id = (r.body.data as { id: string }).id;
      await esperarJobTerminado(admin.token, id);

      const del = await api().delete(`${IMPORTS}/${id}`).set('Authorization', `Bearer ${admin.token}`);
      expect(del.status).toBe(204);

      const get = await api().get(`${IMPORTS}/${id}`).set('Authorization', `Bearer ${admin.token}`);
      expect(get.status).toBe(404);
    });
  });
});
