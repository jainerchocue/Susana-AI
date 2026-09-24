import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createInternalApp } from '../../src/internal-app';
import { emitirTicket } from '../../src/modules/assistant/assistant.tickets';
import { PERMISSIONS } from '../../src/core/rbac/permissions';
import { env } from '../../src/config/env';

/**
 * Dataset "admissions" del asistente (T10) contra los datos REALES de
 * `hospital_local`: un `count` agrupado por `unit`, ejecutado via la API
 * INTERNA (como haria Python), debe cuadrar con el conteo por
 * `NombreGrupoCama` calculado leyendo `Ingresos.txt` crudo. Igual criterio de
 * independencia que `tests/real-data/conteos.test.ts`: el valor esperado NUNCA
 * reutiliza codigo de `src/scripts/import-data.ts`, se recalcula aqui desde
 * cero. Solo corre con `npm run test:real` (REAL_DATA=1).
 */

const DIR_RAW = path.join(__dirname, '../../data/raw');
// Indice de NombreGrupoCama en Ingresos.txt (ver CABECERA_INGRESOS en src/scripts/import-data.ts).
const INDICE_UNIDAD = 11;

async function contarPorUnidad(): Promise<Record<string, number>> {
  const conteos: Record<string, number> = {};
  const flujo = readline.createInterface({
    input: fs.createReadStream(path.join(DIR_RAW, 'Ingresos.txt'), { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  let esCabecera = true;
  for await (const linea of flujo) {
    if (esCabecera) {
      esCabecera = false;
      continue;
    }
    const unidad = (linea.split('|')[INDICE_UNIDAD] ?? '').trim();
    conteos[unidad] = (conteos[unidad] ?? 0) + 1;
  }
  return conteos;
}

describe.runIf(process.env.REAL_DATA === '1')('asistente · dataset "admissions" (hospital_local)', () => {
  it('count(*) agrupado por unit cuadra con NombreGrupoCama de Ingresos.txt', async () => {
    const esperado = await contarPorUnidad();
    // B0: 17.781 ingresos en el extracto completo.
    expect(Object.values(esperado).reduce((acc, n) => acc + n, 0)).toBe(17_781);

    const app = createInternalApp();
    const ticket = await emitirTicket({
      userId: randomUUID(),
      permissions: [PERMISSIONS.services.read],
      requestId: randomUUID(),
      maxQueries: 5,
      maxRows: 1000,
    });

    const res = await request(app)
      .post('/internal/agent/query')
      .set('X-Internal-Key', env.INTERNAL_API_KEY!)
      .send({
        ticket,
        query: { dataset: 'admissions', metrics: [{ agg: 'count' }], groupBy: [{ field: 'unit' }], limit: 100 },
      });

    expect(res.status).toBe(200);
    const filas = res.body.data.rows as { unit: string; count_all: number }[];
    expect(filas.length).toBeGreaterThan(0);
    expect(res.body.data.truncated).toBe(false);

    const real: Record<string, number> = {};
    for (const fila of filas) real[fila.unit] = fila.count_all;

    expect(real).toEqual(esperado);
  }, 60_000);
});
