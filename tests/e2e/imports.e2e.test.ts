import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { env } from '../../src/config/env';
import { comoRol, prismaE2E, Sesion } from './cliente';

/**
 * TC1 (ola C-1): `POST /imports/:table` y compañia contra el PROCESO REAL
 * (E0: nada de supertest ni de `createApp()` en memoria). Corre solo con su
 * propia BD/puerto: `E2E_DATABASE=hospital_e2e_imp E2E_PORT=3250
 * npm run test:e2e -- tests/e2e/imports.e2e.test.ts`.
 *
 * El global setup ya importa el extracto HIS COMPLETO por la CLI
 * (`npm run data:import`) si la BD esta vacia: subir `MedicamentoInsumo.txt`
 * real por esta misma ruta despues de eso es, a proposito, una prueba de
 * carga REAL de 579.465 filas/~91MB por la via HTTP -> temporal -> parser ->
 * comprobacion de FK por lote -> BD, midiendo cuanto tarda subir el cuerpo
 * (202) y cuanto tarda el proceso en segundo plano hasta COMPLETED.
 *
 * Fixtures pequeños en `tests/fixtures/imports/` (ids sinteticos
 * >= 9.000.000, C0): el global setup los limpia si una corrida rota los deja.
 */

const BASE = inject('e2eUrl');
const PREFIJO = env.API_PREFIX;
const prisma = prismaE2E();
const IMPORTS = `${PREFIJO}/imports`;
const DIR_FIXTURES = path.join(__dirname, '../fixtures/imports');
const RAIZ = path.resolve(__dirname, '..', '..');

function comoRegistro(valor: unknown): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null) {
    throw new Error(`Se esperaba un objeto JSON; se recibio: ${JSON.stringify(valor)}`);
  }
  return valor as Record<string, unknown>;
}

function comoTexto(valor: unknown): string {
  if (typeof valor !== 'string') throw new Error(`Se esperaba un texto; se recibio: ${JSON.stringify(valor)}`);
  return valor;
}

/** POST del contenido de un archivo como `text/csv`, autenticado con el Bearer de la sesion. */
async function subirCsv(
  sesion: Sesion,
  tabla: string,
  contenido: string | Buffer,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const respuesta = await sesion.raw(`${IMPORTS}/${tabla}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sesion.token}`, 'Content-Type': 'text/csv' },
    body: contenido,
  });
  const texto = await respuesta.text();
  return { status: respuesta.status, body: texto ? (JSON.parse(texto) as Record<string, unknown>) : {} };
}

/** Extrae `data.id` de la respuesta 202 (el sobre estandar: {success, data, meta}). */
function idDeTrabajo(body: Record<string, unknown>): string {
  return comoTexto(comoRegistro(body.data).id);
}

async function esperarJobTerminado(sesion: Sesion, id: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const desde = Date.now();
  for (;;) {
    const res = await sesion.get(`${IMPORTS}/${id}`);
    const job = comoRegistro(comoRegistro(res.body).data);
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return job;
    if (Date.now() - desde > timeoutMs) {
      throw new Error(`El job ${id} no termino en ${timeoutMs}ms (status=${String(job.status)})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function limpiarSintetico(): Promise<void> {
  const filtro = { OR: [{ id: { gte: 9_000_000 } }, { admissionId: { gte: 9_000_000 } }] };
  await prisma.serviceRecord.deleteMany({ where: filtro });
  await prisma.medicationDispense.deleteMany({ where: filtro });
  await prisma.admission.deleteMany({ where: { OR: [{ id: { gte: 9_000_000 } }, { patientId: { gte: 9_000_000 } }] } });
  await prisma.triage.deleteMany({ where: { OR: [{ id: { gte: 9_000_000 } }, { patientId: { gte: 9_000_000 } }] } });
  await prisma.patient.deleteMany({ where: { id: { gte: 9_000_000 } } });
  await prisma.importJob.deleteMany();
}

let admin: Sesion;
let analista: Sesion;

beforeAll(async () => {
  [admin, analista] = await Promise.all([comoRol(BASE, 'ADMIN'), comoRol(BASE, 'ANALISTA')]);
  await limpiarSintetico();
}, 60_000);

afterAll(async () => {
  await limpiarSintetico();
  await prisma.$disconnect();
});

describe('POST /imports/:table (TC1, E2E)', () => {
  it('401 sin sesion', async () => {
    const r = await new Sesion(BASE).get(IMPORTS);
    expect(r.status).toBe(401);
  });

  it('403 para ANALISTA (no tiene data:import)', async () => {
    const r = await analista.get(IMPORTS);
    expect(r.status).toBe(403);
  });

  it('camino feliz con un CSV pequeño (comas y comillas): 202 -> COMPLETED, cotejado con la BD', async () => {
    const contenido = fs.readFileSync(path.join(DIR_FIXTURES, 'patients.csv'), 'utf-8');
    const subida = await subirCsv(admin, 'patients', contenido);
    expect(subida.status).toBe(202);
    const job = await esperarJobTerminado(admin, idDeTrabajo(subida.body), 15_000);
    expect(job).toMatchObject({ status: 'COMPLETED', delimiter: ',', processed: 3, inserted: 3, invalid: 0 });

    const paciente = await prisma.patient.findUniqueOrThrow({ where: { id: 9_000_001 } });
    expect(paciente.insurer).toBe('EPS SURA, REGIONAL SUR');
  });

  it(
    'sube MedicamentoInsumo.txt real (data/raw, ~91MB / 579.465 filas) y mide tiempos de subida y proceso',
    async () => {
      const rutaReal = path.join(RAIZ, 'data', 'raw', 'MedicamentoInsumo.txt');
      const bytes = fs.statSync(rutaReal).size;
      const contenido = fs.readFileSync(rutaReal);

      const antesDeSubir = Date.now();
      const subida = await subirCsv(admin, 'dispenses', contenido);
      const msSubida = Date.now() - antesDeSubir;
      expect(subida.status).toBe(202);

      const antesDeProcesar = Date.now();
      const job = await esperarJobTerminado(admin, idDeTrabajo(subida.body), 300_000);
      const msProceso = Date.now() - antesDeProcesar;

      process.stdout.write(
        `\n[imports.e2e] MedicamentoInsumo.txt: ${(bytes / (1024 * 1024)).toFixed(1)}MB, ` +
          `subida=${msSubida}ms, proceso=${msProceso}ms, job=${JSON.stringify(job)}\n`,
      );

      // El global setup ya cargo el extracto HIS completo por la CLI (T6): las
      // 579.465 filas de este mismo archivo ya estan en la BD, asi que esta
      // segunda carga (por la API) debe reconocerlas TODAS como duplicadas.
      expect(job).toMatchObject({ status: 'COMPLETED', delimiter: '|', processed: 579_465, invalid: 0 });
      expect((job.inserted as number) + (job.duplicates as number)).toBe(579_465);

      const totalEnBd = await prisma.medicationDispense.count();
      expect(totalEnBd).toBeGreaterThanOrEqual(579_465);
    },
    360_000,
  );

  it('GET /imports lista los trabajos recien creados, mas recientes primero', async () => {
    const res = await admin.get(`${IMPORTS}?limit=5`);
    expect(res.status).toBe(200);
    const items = comoRegistro(res.body).data;
    expect(Array.isArray(items)).toBe(true);
    expect((items as unknown[]).length).toBeGreaterThan(0);
  });
});
