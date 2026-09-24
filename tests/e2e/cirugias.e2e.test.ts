import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { env } from '../../src/config/env';
import { Sesion, comoRol, credenciales, prismaE2E } from './cliente';

/**
 * T15 (ola E2): `GET /analytics/surgeries` y su export CSV, cotejados con
 * Prisma (BD E2E) y, para los totales, RECALCULADOS desde `data/raw/*.txt`
 * (B0: `ProgramacionCirugia.txt` no tiene fecha, asi que este endpoint no
 * acepta periodo). El estilo de lectura de crudos sigue el de
 * `tests/real-data/conteos.test.ts`, pero escrito de cero aqui (E0: nunca se
 * importa ese archivo ni ningun servicio de `src/`).
 */

const BASE = inject('e2eUrl');
const PREFIJO = env.API_PREFIX;
const DIR_RAW = path.join(__dirname, '../../data/raw');

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

function comoNumero(valor: unknown): number {
  if (typeof valor !== 'number' || Number.isNaN(valor)) {
    throw new Error(`Se esperaba un numero; se recibio: ${JSON.stringify(valor)}`);
  }
  return valor;
}

function comoTexto(valor: unknown): string {
  if (typeof valor !== 'string') throw new Error(`Se esperaba un string; se recibio: ${JSON.stringify(valor)}`);
  return valor;
}

function redondear(valor: number, decimales = 2): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

// ── Lectura de crudos (independiente de src/scripts/import-data.ts) ─────────

async function* lineas(ruta: string): AsyncGenerator<string> {
  const flujo = readline.createInterface({ input: fs.createReadStream(ruta, { encoding: 'utf-8' }), crlfDelay: Infinity });
  let esCabecera = true;
  for await (const linea of flujo) {
    if (esCabecera) {
      esCabecera = false;
      continue;
    }
    if (linea.length === 0) continue;
    yield linea;
  }
}

/** IDs de ingreso presentes en el extracto (Ingresos.txt, columna 0). */
async function cargarIdsIngresos(): Promise<Set<string>> {
  const ids = new Set<string>();
  for await (const linea of lineas(path.join(DIR_RAW, 'Ingresos.txt'))) {
    const id = linea.split('|')[0] ?? '';
    if (id !== '') ids.add(id);
  }
  return ids;
}

/** Pares (OidIngreso, CodigoServicio) de Servicios.txt (columnas 0 y 1). */
async function cargarParesServicios(): Promise<Set<string>> {
  const pares = new Set<string>();
  for await (const linea of lineas(path.join(DIR_RAW, 'Servicios.txt'))) {
    const campos = linea.split('|');
    pares.add(`${campos[0] ?? ''}|${campos[1] ?? ''}`);
  }
  return pares;
}

interface ConteoCirugiasRaw {
  total: number;
  duplicadas: number;
  insertadas: number;
  si: number;
  no: number;
  desconocido: number;
}

/**
 * Recalcula desde `ProgramacionCirugia.txt` los mismos tres estados que
 * calcula `import-data.ts` con SQL tras la carga (B0):
 *  - "desconocido": sin OidIngreso, o con uno que no esta en el extracto.
 *  - "si": el ingreso SI esta en el extracto y (OidIngreso, CodigoServicio)
 *    aparece en Servicios.txt (= ejecutada verificable).
 *  - "no": el ingreso esta en el extracto pero ese codigo no aparece alli.
 * Deduplicacion por LINEA COMPLETA (276 duplicadas exactas, B0), igual que el
 * importador (que dedupe por `campos.join('|')`, equivalente a la linea cruda
 * porque el archivo no tiene comillas ni columnas con '|' embebido).
 */
async function calcularCirugiasDesdeCrudos(
  idsIngresos: Set<string>,
  paresServicios: Set<string>,
): Promise<ConteoCirugiasRaw> {
  const vistos = new Set<string>();
  let total = 0;
  let duplicadas = 0;
  let si = 0;
  let no = 0;
  let desconocido = 0;

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

    if (oidIngreso === '' || !idsIngresos.has(oidIngreso)) {
      desconocido += 1;
    } else if (paresServicios.has(`${oidIngreso}|${codigoServicio}`)) {
      si += 1;
    } else {
      no += 1;
    }
  }

  return { total, duplicadas, insertadas: total - duplicadas, si, no, desconocido };
}

const PELIGROSO = /^[=+\-@\t\r]/;
function verificarCeldaSegura(celdaCsv: string, valorOriginal: string): void {
  if (PELIGROSO.test(valorOriginal)) {
    expect(celdaCsv.startsWith("'"), `celda peligrosa sin neutralizar: "${celdaCsv}"`).toBe(true);
    expect(celdaCsv.slice(1)).toBe(valorOriginal);
  } else {
    expect(PELIGROSO.test(celdaCsv), `celda no deberia empezar por = + - @ tab o CR: "${celdaCsv}"`).toBe(false);
    expect(celdaCsv).toBe(valorOriginal);
  }
}

/** Parser RFC4180 minimo: `enviarCsv` cita SIEMPRE cada celda. */
function parsearCsv(texto: string): string[][] {
  const lineasCsv = texto.split('\r\n').filter((l) => l.length > 0);
  return lineasCsv.map((linea) => {
    const campos: string[] = [];
    const re = /"((?:[^"]|"")*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(linea)) !== null) campos.push((m[1] ?? '').replace(/""/g, '"'));
    return campos;
  });
}

function aTextoLocal(valor: string | number | null): string {
  return valor === null ? '' : String(valor);
}

describe('T15: GET /analytics/surgeries cotejado con la BD y con data/raw/', () => {
  let director: Sesion;
  let farmacia: Sesion;
  let analista: Sesion;
  const tiempos: Record<string, number> = {};

  beforeAll(async () => {
    director = new Sesion(BASE);
    expect((await director.login(credenciales.director.email, credenciales.director.password)).status).toBe(200);
    farmacia = new Sesion(BASE);
    expect((await farmacia.login(credenciales.farmacia.email, credenciales.farmacia.password)).status).toBe(200);
    analista = await comoRol(BASE, 'ANALISTA');
  }, 60_000);

  afterAll(async () => {
    await prismaE2E().$disconnect();
  });

  async function medir<T>(etiqueta: string, accion: () => Promise<T>): Promise<T> {
    const inicio = Date.now();
    const resultado = await accion();
    tiempos[etiqueta] = Date.now() - inicio;
    return resultado;
  }

  describe('permisos y validacion', () => {
    it('sin sesion -> 401', async () => {
      const anonimo = new Sesion(BASE);
      expect((await anonimo.get(`${PREFIJO}/analytics/surgeries`)).status).toBe(401);
      expect((await anonimo.get(`${PREFIJO}/analytics/surgeries/export`)).status).toBe(401);
    });

    it('FARMACIA -> 403 en resumen y export (sin analytics.read ni surgeries.read)', async () => {
      expect((await farmacia.get(`${PREFIJO}/analytics/surgeries`)).status).toBe(403);
      expect((await farmacia.get(`${PREFIJO}/analytics/surgeries/export`)).status).toBe(403);
    });

    it('ANALISTA -> 200 en resumen, 403 en export (sin analytics:export)', async () => {
      expect((await analista.get(`${PREFIJO}/analytics/surgeries`)).status).toBe(200);
      expect((await analista.get(`${PREFIJO}/analytics/surgeries/export`)).status).toBe(403);
    });

    it('parametro desconocido -> 422 (sin fecha en el HIS: emptyQuerySchema.strict(), B0)', async () => {
      const r = await director.get(`${PREFIJO}/analytics/surgeries?desde=2026-01-01`);
      expect(r.status).toBe(422);
      expect(comoRegistro(comoRegistro(r.body).error).code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /analytics/surgeries: totales cotejados con la BD y con data/raw/', () => {
    it(
      'totalSchedules, si/no/desconocido, top procedimientos y por unidad',
      async () => {
        const r = await medir('surgeries:summary', () => director.get(`${PREFIJO}/analytics/surgeries`));
        expect(r.status).toBe(200);
        const data = comoRegistro(comoRegistro(r.body).data);

        // 1) Recalculo INDEPENDIENTE desde data/raw/ (idsIngresos y paresServicios
        // se cargan una sola vez: Servicios.txt tiene 582.357 lineas).
        const [idsIngresos, paresServicios] = await Promise.all([cargarIdsIngresos(), cargarParesServicios()]);
        const crudos = await calcularCirugiasDesdeCrudos(idsIngresos, paresServicios);

        // Cifras ya verificadas en el plan (B0/T15): 13.046 filas, 276 duplicadas
        // exactas -> 12.770 insertadas; si/no/desconocido = 2.216/1.048/9.506.
        expect(crudos.total).toBe(13_046);
        expect(crudos.duplicadas).toBe(276);
        expect(crudos.insertadas).toBe(12_770);
        expect(crudos.si).toBe(2_216);
        expect(crudos.no).toBe(1_048);
        expect(crudos.desconocido).toBe(9_506);
        expect(crudos.si + crudos.no + crudos.desconocido).toBe(crudos.insertadas);

        // 2) La BD debe coincidir con el recalculo desde crudos.
        const [totalDb, siDb, noDb, desconocidoDb, distinctProceduresDb] = await Promise.all([
          prismaE2E().surgerySchedule.count(),
          prismaE2E().surgerySchedule.count({ where: { executed: 'si' } }),
          prismaE2E().surgerySchedule.count({ where: { executed: 'no' } }),
          prismaE2E().surgerySchedule.count({ where: { executed: 'desconocido' } }),
          prismaE2E()
            .surgerySchedule.findMany({ distinct: ['procedureCode'], select: { procedureCode: true } })
            .then((f) => f.length),
        ]);
        expect(totalDb).toBe(crudos.insertadas);
        expect(siDb).toBe(crudos.si);
        expect(noDb).toBe(crudos.no);
        expect(desconocidoDb).toBe(crudos.desconocido);

        // 3) La API debe coincidir con la BD (si aqui difiere siendo la BD y los
        // crudos iguales, es un BUG del endpoint, no del calculo de este test).
        expect(comoNumero(data.totalSchedules)).toBe(totalDb);
        expect(comoNumero(data.distinctProcedures)).toBe(distinctProceduresDb);
        expect(comoNumero(data.unknown)).toBe(desconocidoDb);

        const verifiable = comoRegistro(data.verifiable);
        expect(comoNumero(verifiable.total)).toBe(siDb + noDb);
        expect(comoNumero(verifiable.executed)).toBe(siDb);
        expect(comoNumero(verifiable.notExecuted)).toBe(noDb);
        expect(comoNumero(verifiable.executedPct)).toBeCloseTo(redondear((siDb / (siDb + noDb)) * 100), 2);
        expect(comoNumero(verifiable.notExecutedPct)).toBeCloseTo(redondear((noDb / (siDb + noDb)) * 100), 2);

        const conIngreso = comoRegistro(data.withAdmissionInExtract);
        expect(comoNumero(conIngreso.count)).toBe(siDb + noDb);
        expect(comoNumero(conIngreso.pct)).toBeCloseTo(redondear(((siDb + noDb) / totalDb) * 100), 2);

        // 4) Top 10 procedimientos: mismo desempate que el servicio (count desc,
        // codigo asc) porque es la unica forma de que el orden sea comparable
        // cuando hay empates; los VALORES (conteo, nombre) se leen aparte.
        const grupos = await prismaE2E().surgerySchedule.groupBy({ by: ['procedureCode'], _count: { procedureCode: true } });
        const top10 = [...grupos]
          .sort((a, b) => b._count.procedureCode - a._count.procedureCode || a.procedureCode.localeCompare(b.procedureCode))
          .slice(0, 10);
        const nombres = await prismaE2E().procedure.findMany({ where: { code: { in: top10.map((g) => g.procedureCode) } } });
        const nombrePorCodigo = new Map(nombres.map((p) => [p.code, p.name]));
        const topApi = comoArreglo(data.topProcedures).map(comoRegistro);
        expect(topApi).toHaveLength(top10.length);
        topApi.forEach((fila, i) => {
          const esperado = top10[i];
          if (!esperado) throw new Error(`fila ${i} inesperada`);
          expect(comoTexto(fila.code)).toBe(esperado.procedureCode);
          expect(comoNumero(fila.count)).toBe(esperado._count.procedureCode);
          expect(fila.name).toBe(nombrePorCodigo.get(esperado.procedureCode) ?? null);
        });

        // 5) Por unidad: solo programaciones verificables (si/no) con ingreso
        // vinculado; se cruza en memoria porque SurgerySchedule no tiene FK (B0).
        const verificablesConIngreso = await prismaE2E().surgerySchedule.findMany({
          where: { executed: { not: 'desconocido' }, admissionId: { not: null } },
          select: { admissionId: true },
        });
        const idsAdmision = [...new Set(verificablesConIngreso.map((f) => f.admissionId).filter((id): id is number => id !== null))];
        const admisiones =
          idsAdmision.length > 0
            ? await prismaE2E().admission.findMany({ where: { id: { in: idsAdmision } }, select: { id: true, unit: true } })
            : [];
        const unidadPorIngreso = new Map(admisiones.map((a) => [a.id, a.unit]));
        const conteoPorUnidad = new Map<string, number>();
        for (const fila of verificablesConIngreso) {
          const unidad = fila.admissionId !== null ? unidadPorIngreso.get(fila.admissionId) : undefined;
          if (!unidad) continue;
          conteoPorUnidad.set(unidad, (conteoPorUnidad.get(unidad) ?? 0) + 1);
        }
        const porUnidadEsperado = [...conteoPorUnidad.entries()]
          .map(([unit, count]) => ({ unit, count }))
          .sort((a, b) => b.count - a.count || a.unit.localeCompare(b.unit));
        const byUnitApi = comoArreglo(data.byUnit).map(comoRegistro);
        expect(byUnitApi).toHaveLength(porUnidadEsperado.length);
        byUnitApi.forEach((fila, i) => {
          const esperado = porUnidadEsperado[i];
          if (!esperado) throw new Error(`fila ${i} inesperada`);
          expect(comoTexto(fila.unit)).toBe(esperado.unit);
          expect(comoNumero(fila.count)).toBe(esperado.count);
        });
      },
      120_000,
    );
  });

  describe('GET /analytics/surgeries/export', () => {
    it(
      'CSV con las 12.770 filas, mismo desglose que el resumen JSON y auditoria data.export',
      async () => {
        const [resumen, csv] = await Promise.all([
          director.get(`${PREFIJO}/analytics/surgeries`),
          medir('surgeries/export', () => director.get(`${PREFIJO}/analytics/surgeries/export`)),
        ]);
        expect(resumen.status).toBe(200);
        expect(csv.status).toBe(200);
        expect(csv.headers.get('content-type')).toContain('text/csv');
        expect(csv.headers.get('content-disposition')).toContain('attachment');

        const filasCsv = parsearCsv(comoTexto(csv.body));
        const [cabecera, ...cuerpo] = filasCsv;
        expect(cabecera).toEqual([
          'scheduleNumber',
          'patientId',
          'admissionId',
          'procedureCode',
          'procedureName',
          'unit',
          'executed',
        ]);

        const resumenData = comoRegistro(comoRegistro(resumen.body).data);
        expect(cuerpo).toHaveLength(comoNumero(resumenData.totalSchedules));

        // Desglose si/no/desconocido del CSV == el mismo desglose del JSON del resumen.
        const conteoCsv = { si: 0, no: 0, desconocido: 0 };
        for (const fila of cuerpo) {
          const executed = fila[6] ?? '';
          if (executed === 'si') conteoCsv.si += 1;
          else if (executed === 'no') conteoCsv.no += 1;
          else if (executed === 'desconocido') conteoCsv.desconocido += 1;
          else throw new Error(`executed inesperado en el CSV: "${executed}"`);
        }
        const verifiable = comoRegistro(resumenData.verifiable);
        expect(conteoCsv.si).toBe(comoNumero(verifiable.executed));
        expect(conteoCsv.no).toBe(comoNumero(verifiable.notExecuted));
        expect(conteoCsv.desconocido).toBe(comoNumero(resumenData.unknown));

        // Comparacion fila a fila contra una lectura Prisma propia, en el MISMO
        // orden documentado por el servicio (scheduleNumber, id): es el unico
        // orden en el que las filas del CSV y las de una consulta ordenada se
        // corresponden 1 a 1; los VALORES (procedureName, unit) se resuelven
        // aqui con sus propios `findMany`, no importando el servicio.
        const schedules = await prismaE2E().surgerySchedule.findMany({ orderBy: [{ scheduleNumber: 'asc' }, { id: 'asc' }] });
        expect(schedules).toHaveLength(cuerpo.length);

        const codigos = [...new Set(schedules.map((s) => s.procedureCode))];
        const idsAdmision = [...new Set(schedules.map((s) => s.admissionId).filter((id): id is number => id !== null))];
        const [procedimientos, admisiones] = await Promise.all([
          prismaE2E().procedure.findMany({ where: { code: { in: codigos } } }),
          prismaE2E().admission.findMany({ where: { id: { in: idsAdmision } }, select: { id: true, unit: true } }),
        ]);
        const nombrePorCodigo = new Map(procedimientos.map((p) => [p.code, p.name]));
        const unidadPorIngreso = new Map(admisiones.map((a) => [a.id, a.unit]));

        for (let i = 0; i < schedules.length; i++) {
          const s = schedules[i];
          const celdas = cuerpo[i];
          if (!s || !celdas) throw new Error(`fila ${i} inesperada`);
          const unidad = s.admissionId !== null ? (unidadPorIngreso.get(s.admissionId) ?? null) : null;
          const esperado = [
            aTextoLocal(s.scheduleNumber),
            aTextoLocal(s.patientId),
            aTextoLocal(s.admissionId),
            aTextoLocal(s.procedureCode),
            aTextoLocal(nombrePorCodigo.get(s.procedureCode) ?? null),
            aTextoLocal(unidad),
            aTextoLocal(s.executed),
          ];
          for (let col = 0; col < esperado.length; col++) {
            verificarCeldaSegura(celdas[col] ?? '', esperado[col] ?? '');
          }
        }

        const requestId = csv.headers.get('x-request-id');
        expect(requestId).toBeTruthy();
        const auditoria = await prismaE2E().auditLog.findFirst({ where: { requestId, action: 'data.export' } });
        expect(auditoria, 'fila de auditoria data.export para esta descarga').toBeTruthy();
        expect(comoRegistro(auditoria?.metadata).report).toBe('surgeries');
        expect(comoRegistro(auditoria?.metadata).filas).toBe(cuerpo.length);
      },
      120_000,
    );
  });

  describe('tiempos de respuesta (< 1s esperado en E2E; se mide y reporta)', () => {
    it('el resumen responde en menos de 3s (margen por CPU compartida); el export (12.770 filas) en menos de 5s', () => {
      expect(tiempos['surgeries:summary']).toBeDefined();
      expect(tiempos['surgeries:summary'], `tardo ${tiempos['surgeries:summary']}ms`).toBeLessThan(3000);
      expect(tiempos['surgeries/export']).toBeDefined();
      expect(tiempos['surgeries/export'], `tardo ${tiempos['surgeries/export']}ms`).toBeLessThan(5000);
    });
  });
});
