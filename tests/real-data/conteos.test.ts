import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { describe, expect, it } from 'vitest';
import { prisma } from '../helpers';

/**
 * Verificacion contra los datos REALES importados en `hospital_local` (T6).
 * Solo corre con `npm run test:real` (REAL_DATA=1): `tests/setup.ts` no fija
 * DATABASE_URL en ese modo, asi que usa la de `.env`.
 *
 * A proposito, cada valor esperado se calcula AQUI leyendo `data/raw/*.txt`
 * de cero (streaming, sin reutilizar nada de `src/scripts/import-data.ts`):
 * el objetivo es una verificacion independiente, no una repeticion del mismo
 * codigo contra si mismo.
 */

const DIR_RAW = path.join(__dirname, '../../data/raw');
const RE_NIVEL_TRIAGE = /TRIAGE\s*([1-5])/;

async function* lineas(ruta: string): AsyncGenerator<string> {
  const flujo = readline.createInterface({ input: fs.createReadStream(ruta, { encoding: 'utf-8' }), crlfDelay: Infinity });
  let esCabecera = true;
  for await (const linea of flujo) {
    if (esCabecera) {
      esCabecera = false;
      continue;
    }
    yield linea;
  }
}

async function contarLineas(archivo: string): Promise<number> {
  let n = 0;
  for await (const _linea of lineas(path.join(DIR_RAW, archivo))) n += 1;
  return n;
}

async function contarTriagesReales(): Promise<number> {
  let n = 0;
  for await (const linea of lineas(path.join(DIR_RAW, 'Triage.txt'))) {
    if (linea.split('|').every((c) => c === '')) continue;
    n += 1;
  }
  return n;
}

async function contarCamasVirtuales(): Promise<number> {
  const virtuales = new Set<string>();
  for await (const linea of lineas(path.join(DIR_RAW, 'Ingresos.txt'))) {
    const campos = linea.split('|');
    const codigoCama = campos[9] ?? '';
    const nombreCama = campos[10] ?? '';
    if (nombreCama.includes('VIRTUAL')) virtuales.add(codigoCama);
  }
  return virtuales.size;
}

async function cargarIdsIngresos(): Promise<Set<string>> {
  const ids = new Set<string>();
  for await (const linea of lineas(path.join(DIR_RAW, 'Ingresos.txt'))) {
    const id = linea.split('|')[0] ?? '';
    if (id !== '') ids.add(id);
  }
  return ids;
}

/** Una pasada por Servicios.txt: cuenta lineas Y arma el set de pares (ingreso, codigo). */
async function cargarServicios(): Promise<{ total: number; pares: Set<string> }> {
  const pares = new Set<string>();
  let total = 0;
  for await (const linea of lineas(path.join(DIR_RAW, 'Servicios.txt'))) {
    total += 1;
    const campos = linea.split('|');
    pares.add(`${campos[0] ?? ''}|${campos[1] ?? ''}`);
  }
  return { total, pares };
}

interface ResumenCirugias {
  total: number;
  duplicadas: number;
  insertadas: number;
  siVerificable: number;
}

async function calcularCirugias(idsIngresos: Set<string>, paresServicios: Set<string>): Promise<ResumenCirugias> {
  const vistos = new Set<string>();
  let total = 0;
  let duplicadas = 0;
  let siVerificable = 0;
  for await (const linea of lineas(path.join(DIR_RAW, 'ProgramacionCirugia.txt'))) {
    total += 1;
    if (vistos.has(linea)) {
      duplicadas += 1;
      continue;
    }
    vistos.add(linea);
    const campos = linea.split('|');
    const oidIngreso = campos[2] ?? '';
    const codigoServicio = campos[3] ?? '';
    if (oidIngreso !== '' && idsIngresos.has(oidIngreso) && paresServicios.has(`${oidIngreso}|${codigoServicio}`)) {
      siVerificable += 1;
    }
  }
  return { total, duplicadas, insertadas: total - duplicadas, siVerificable };
}

interface TriageReal {
  level: number | null;
  triagedAtMs: number;
}

async function cargarTriagesPorId(): Promise<Map<string, TriageReal>> {
  const mapa = new Map<string, TriageReal>();
  for await (const linea of lineas(path.join(DIR_RAW, 'Triage.txt'))) {
    const campos = linea.split('|');
    if (campos.every((c) => c === '')) continue;
    const id = campos[0] ?? '';
    const fecha = campos[1] ?? '';
    const clasificacion = campos[9] ?? '';
    const grupo = RE_NIVEL_TRIAGE.exec(clasificacion)?.[1];
    mapa.set(id, { level: grupo ? Number(grupo) : null, triagedAtMs: Date.parse(`${fecha.replace(' ', 'T')}Z`) });
  }
  return mapa;
}

async function cargarTriageDeIngreso(): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for await (const linea of lineas(path.join(DIR_RAW, 'Ingresos.txt'))) {
    const campos = linea.split('|');
    const oidIngreso = campos[0] ?? '';
    const oidTriageA = campos[8] ?? '';
    if (oidTriageA !== '') mapa.set(oidIngreso, oidTriageA);
  }
  return mapa;
}

async function cargarPrimeraAtencion(): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  for await (const linea of lineas(path.join(DIR_RAW, 'Atencion.txt'))) {
    const campos = linea.split('|');
    const oidIngreso = campos[0] ?? '';
    const fecha = campos[1] ?? '';
    mapa.set(oidIngreso, Date.parse(`${fecha.replace(' ', 'T')}Z`));
  }
  return mapa;
}

function mediana(valores: number[]): number {
  const ordenado = [...valores].sort((a, b) => a - b);
  const n = ordenado.length;
  if (n === 0) return NaN;
  const mitad = Math.floor(n / 2);
  if (n % 2 === 0) return ((ordenado[mitad - 1] ?? 0) + (ordenado[mitad] ?? 0)) / 2;
  return ordenado[mitad] ?? 0;
}

/** Espera (minutos) por nivel de triage, calculada leyendo Ingresos+Triage+Atencion crudos. */
async function calcularMedianasEsperaPorNivel(): Promise<Map<number, number>> {
  const [triagesPorId, triageDeIngreso, primeraAtencion] = await Promise.all([
    cargarTriagesPorId(),
    cargarTriageDeIngreso(),
    cargarPrimeraAtencion(),
  ]);

  const porNivel = new Map<number, number[]>();
  for (const [oidIngreso, oidTriage] of triageDeIngreso) {
    const triage = triagesPorId.get(oidTriage);
    const atencionMs = primeraAtencion.get(oidIngreso);
    if (!triage || triage.level === null || atencionMs === undefined) continue;
    const minutos = (atencionMs - triage.triagedAtMs) / 60_000;
    const lista = porNivel.get(triage.level) ?? [];
    lista.push(minutos);
    porNivel.set(triage.level, lista);
  }

  const medianas = new Map<number, number>();
  for (const [nivel, valores] of porNivel) medianas.set(nivel, mediana(valores));
  return medianas;
}

describe.runIf(process.env.REAL_DATA === '1')('conteos reales (hospital_local)', () => {
  it('pacientes: 14.502', async () => {
    const [esperado, real] = await Promise.all([contarLineas('Paciente.txt'), prisma.patient.count()]);
    expect(esperado).toBe(14_502);
    expect(real).toBe(esperado);
  }, 60_000);

  it('ingresos: 17.781', async () => {
    const [esperado, real] = await Promise.all([contarLineas('Ingresos.txt'), prisma.admission.count()]);
    expect(esperado).toBe(17_781);
    expect(real).toBe(esperado);
  }, 60_000);

  it('triages reales (sin las filas vacias): 16.106', async () => {
    const [esperado, real] = await Promise.all([contarTriagesReales(), prisma.triage.count()]);
    expect(esperado).toBe(16_106);
    expect(real).toBe(esperado);
  }, 60_000);

  it('ingresos con firstCareAt (Atencion.txt, 1:1 sin huerfanos): 17.375', async () => {
    const [esperado, real] = await Promise.all([
      contarLineas('Atencion.txt'),
      prisma.admission.count({ where: { firstCareAt: { not: null } } }),
    ]);
    expect(esperado).toBe(17_375);
    expect(real).toBe(esperado);
  }, 60_000);

  it('medicamentos/insumos: 579.465', async () => {
    const [esperado, real] = await Promise.all([contarLineas('MedicamentoInsumo.txt'), prisma.medicationDispense.count()]);
    expect(esperado).toBe(579_465);
    expect(real).toBe(esperado);
  }, 180_000);

  it('camas virtuales: 347', async () => {
    const [esperado, real] = await Promise.all([
      contarCamasVirtuales(),
      prisma.admission.findMany({ where: { virtualBed: true }, select: { bedCode: true }, distinct: ['bedCode'] }),
    ]);
    expect(esperado).toBe(347);
    expect(real).toHaveLength(esperado);
  }, 60_000);

  it('servicios: 582.357, y cirugias/executed calculados desde los crudos', async () => {
    const [idsIngresos, { total: totalServicios, pares: paresServicios }, realServicios] = await Promise.all([
      cargarIdsIngresos(),
      cargarServicios(),
      prisma.serviceRecord.count(),
    ]);
    expect(totalServicios).toBe(582_357);
    expect(realServicios).toBe(totalServicios);

    const cirugias = await calcularCirugias(idsIngresos, paresServicios);
    // 13.046 filas en el archivo, 276 duplicadas exactas -> 12.770 insertadas (B0).
    expect(cirugias.total).toBe(13_046);
    expect(cirugias.duplicadas).toBe(276);
    expect(cirugias.insertadas).toBe(12_770);
    // 2.228 es el numero de B0 sobre las 13.046 filas crudas (incluye duplicados);
    // tras deduplicar, las filas duplicadas exactas de una fila "si" restan una
    // vez cada una de las copias de mas.
    const realCirugias = await prisma.surgerySchedule.count();
    const realSiVerificable = await prisma.surgerySchedule.count({ where: { executed: 'si' } });
    expect(realCirugias).toBe(cirugias.insertadas);
    expect(realSiVerificable).toBe(cirugias.siVerificable);
  }, 300_000);

  it('mediana de espera (minutos) por nivel de triage, tolerancia 0.01', async () => {
    const esperadas = await calcularMedianasEsperaPorNivel();

    const filas = await prisma.$queryRaw<Array<{ level: number; mediana: number }>>`
      SELECT "triageLevel" AS level, percentile_cont(0.5) WITHIN GROUP (ORDER BY "waitMinutes")::float8 AS mediana
      FROM his_admissions
      WHERE "waitMinutes" IS NOT NULL AND "triageLevel" IS NOT NULL
      GROUP BY "triageLevel"
      ORDER BY "triageLevel"
    `;

    expect(filas.length).toBeGreaterThan(0);
    for (const fila of filas) {
      const esperada = esperadas.get(fila.level);
      expect(esperada, `sin mediana calculada para el nivel ${fila.level}`).toBeDefined();
      expect(fila.mediana).toBeCloseTo(esperada ?? NaN, 2);
    }
  }, 120_000);
});
