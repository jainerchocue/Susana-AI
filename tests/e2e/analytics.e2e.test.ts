import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { env } from '../../src/config/env';
import { Sesion, comoRol, credenciales, prismaE2E } from './cliente';

/**
 * T15 (ola E2): `/analytics/services`, `/analytics/triage` y sus exports CSV,
 * cotejados con los datos HIS reales.
 *
 * E0: cada cifra se recalcula aqui con consultas Prisma propias (nunca
 * `src/modules/analytics/*`), y con un metodo distinto al del servicio donde
 * es razonable (JS en vez de SQL para agrupar/percentiles).
 */

const BASE = inject('e2eUrl');
const PREFIJO = env.API_PREFIX;
const CINCO_HORAS_MS = 5 * 60 * 60 * 1000;
const UN_DIA_MS = 24 * 60 * 60 * 1000;
const TREINTA_DIAS_MS = 30 * UN_DIA_MS;

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

function diaBogota(fecha: Date): string {
  return new Date(fecha.getTime() - CINCO_HORAS_MS).toISOString().slice(0, 10);
}

function horaBogota(fecha: Date): number {
  return new Date(fecha.getTime() - CINCO_HORAS_MS).getUTCHours();
}

function percentilContinuo(ordenadoAsc: number[], p: number): number {
  const n = ordenadoAsc.length;
  if (n === 0) throw new Error('percentilContinuo: sin datos');
  const rango = p * (n - 1);
  const inferior = Math.floor(rango);
  const superior = Math.ceil(rango);
  const base = ordenadoAsc[inferior] ?? 0;
  if (inferior === superior) return base;
  const siguiente = ordenadoAsc[superior] ?? base;
  return base + (rango - inferior) * (siguiente - base);
}

/**
 * Verifica un "top N" ordenado SOLO por `valor DESC` (sin desempate en el SQL
 * del servicio: `ORDER BY quantity DESC LIMIT 10`, `ORDER BY n DESC LIMIT 15`).
 * Comparar el orden exacto seria fragil si hay empates en la frontera del
 * corte: se valida en cambio que (a) cada fila de la API tenga el valor
 * correcto y (b) ninguna clave con valor ESTRICTAMENTE mayor que el umbral
 * quede fuera.
 */
function verificarTopN(filasApi: Array<{ clave: string; valor: number }>, totales: Map<string, number>, n: number): void {
  expect(filasApi).toHaveLength(Math.min(n, totales.size));
  for (const fila of filasApi) expect(totales.get(fila.clave)).toBe(fila.valor);

  const ordenadoDesc = [...totales.values()].sort((a, b) => b - a);
  const umbral = ordenadoDesc[Math.min(n, ordenadoDesc.length) - 1] ?? 0;
  const clavesApi = new Set(filasApi.map((f) => f.clave));
  for (const [clave, valor] of totales) {
    if (valor > umbral) expect(clavesApi.has(clave), `"${clave}" (${valor}) deberia estar en el top ${n}`).toBe(true);
  }
}

const PELIGROSO = /^[=+\-@\t\r]/;
/**
 * Compara una celda del CSV con el valor original de la BD, verificando la
 * neutralizacion de inyeccion de formulas (`core/http/csv.ts`): si el valor
 * original empieza por `= + - @` (o tab/CR), la celda debe llevar el prefijo
 * `'` de escape; si no, la celda debe ser el valor tal cual, SIN ese prefijo
 * y sin empezar por ninguno de esos caracteres.
 */
function verificarCeldaSegura(celdaCsv: string, valorOriginal: string): void {
  if (PELIGROSO.test(valorOriginal)) {
    expect(celdaCsv.startsWith("'"), `celda peligrosa sin neutralizar: "${celdaCsv}"`).toBe(true);
    expect(celdaCsv.slice(1)).toBe(valorOriginal);
  } else {
    expect(PELIGROSO.test(celdaCsv), `celda no deberia empezar por = + - @ tab o CR: "${celdaCsv}"`).toBe(false);
    expect(celdaCsv).toBe(valorOriginal);
  }
}

/** Parser RFC4180 minimo: `enviarCsv` cita SIEMPRE cada celda, asi que basta extraer los `"..."`. */
function parsearCsv(texto: string): string[][] {
  const lineas = texto.split('\r\n').filter((l) => l.length > 0);
  return lineas.map((linea) => {
    const campos: string[] = [];
    const re = /"((?:[^"]|"")*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(linea)) !== null) campos.push((m[1] ?? '').replace(/""/g, '"'));
    return campos;
  });
}

describe('T15: /analytics/services y /analytics/triage cotejados con los datos HIS reales', () => {
  let director: Sesion;
  let consulta: Sesion;
  let analista: Sesion;
  let datosHasta: Date;
  const tiempos: Record<string, number> = {};

  beforeAll(async () => {
    director = new Sesion(BASE);
    expect((await director.login(credenciales.director.email, credenciales.director.password)).status).toBe(200);
    consulta = await comoRol(BASE, 'CONSULTA');
    analista = await comoRol(BASE, 'ANALISTA');

    const fila = await prismaE2E().admission.aggregate({ _max: { admittedAt: true } });
    if (!fila._max.admittedAt) throw new Error('sin datos HIS importados: max(admittedAt) es null');
    datosHasta = fila._max.admittedAt;
  }, 60_000);

  afterAll(async () => {
    await prismaE2E().$disconnect();
  });

  function periodoExplicito(): { desde: Date; hasta: Date } {
    return { desde: new Date(datosHasta.getTime() - 14 * UN_DIA_MS), hasta: new Date(datosHasta.getTime() - 3 * UN_DIA_MS) };
  }

  function periodoPorDefecto(): { desde: Date; hasta: Date } {
    return { desde: new Date(datosHasta.getTime() - TREINTA_DIAS_MS), hasta: datosHasta };
  }

  function query(periodo?: { desde: Date; hasta: Date }, extra?: Record<string, string>): string {
    const params = { ...(periodo ? { desde: periodo.desde.toISOString(), hasta: periodo.hasta.toISOString() } : {}), ...extra };
    const texto = new URLSearchParams(params).toString();
    return texto ? `?${texto}` : '';
  }

  async function medir<T>(etiqueta: string, accion: () => Promise<T>): Promise<T> {
    const inicio = Date.now();
    const resultado = await accion();
    tiempos[etiqueta] = Date.now() - inicio;
    return resultado;
  }

  describe('validacion de query (mismo periodoQuerySchema en ambos endpoints)', () => {
    it('desde > hasta -> 422', async () => {
      const r = await director.get(`${PREFIJO}/analytics/services${query(undefined, { desde: '2026-09-20', hasta: '2026-09-01' })}`);
      expect(r.status).toBe(422);
    });
    it('rango > 366 dias -> 422', async () => {
      const r = await director.get(`${PREFIJO}/analytics/triage${query(undefined, { desde: '2020-01-01', hasta: '2026-09-21' })}`);
      expect(r.status).toBe(422);
    });
    it('parametro desconocido -> 422', async () => {
      const r = await director.get(`${PREFIJO}/analytics/services${query(undefined, { area: 'URGENCIAS' })}`);
      expect(r.status).toBe(422);
    });
    it('fecha invalida -> 422', async () => {
      const r = await director.get(`${PREFIJO}/analytics/triage${query(undefined, { hasta: 'ayer' })}`);
      expect(r.status).toBe(422);
    });
    it('sin sesion -> 401', async () => {
      const anonimo = new Sesion(BASE);
      for (const ruta of ['services', 'triage', 'services/export', 'triage/export']) {
        expect((await anonimo.get(`${PREFIJO}/analytics/${ruta}`)).status, ruta).toBe(401);
      }
    });
    it('CONSULTA -> 403 (sin analytics.read ni services.read)', async () => {
      expect((await consulta.get(`${PREFIJO}/analytics/services`)).status).toBe(403);
      expect((await consulta.get(`${PREFIJO}/analytics/triage`)).status).toBe(403);
    });
  });

  describe('GET /analytics/services', () => {
    it.each([
      ['periodo por defecto', false],
      ['periodo explicito', true],
    ] as const)('%s: volumen por area/especialidad, top procedimientos y serie diaria', async (etiqueta, explicito) => {
      // `periodoExplicito()` depende de `datosHasta` (lo llena `beforeAll`): no
      // se puede calcular dentro del arreglo de `it.each` (se evalua al
      // describir los tests, antes de cualquier `beforeAll`).
      const periodoParam = explicito ? periodoExplicito() : undefined;
      const periodo = periodoParam ?? periodoPorDefecto();
      const r = await medir(`services:${etiqueta}`, () =>
        director.get(`${PREFIJO}/analytics/services${query(periodoParam)}`),
      );
      expect(r.status).toBe(200);
      const data = comoRegistro(comoRegistro(r.body).data);

      const filas = await prismaE2E().serviceRecord.findMany({
        where: { providedAt: { gte: periodo.desde, lte: periodo.hasta } },
        select: { area: true, specialty: true, quantity: true, providedAt: true, code: true },
      });

      // Volumen por area/especialidad: clave completa (area,specialty) -> sin empates que desambiguar.
      const porAreaEsp = new Map<string, { lines: number; quantity: number }>();
      for (const f of filas) {
        const clave = `${f.area}|${f.specialty}`;
        const actual = porAreaEsp.get(clave) ?? { lines: 0, quantity: 0 };
        actual.lines += 1;
        actual.quantity += f.quantity;
        porAreaEsp.set(clave, actual);
      }
      const filasApi = comoArreglo(data.porAreaEspecialidad).map(comoRegistro);
      expect(filasApi).toHaveLength(porAreaEsp.size);
      for (const fila of filasApi) {
        const clave = `${comoTexto(fila.area)}|${comoTexto(fila.specialty)}`;
        const esperado = porAreaEsp.get(clave);
        expect(esperado, `sin datos propios para ${clave}`).toBeDefined();
        expect(comoNumero(fila.lines)).toBe(esperado?.lines ?? 0);
        expect(comoNumero(fila.quantity)).toBe(esperado?.quantity ?? 0);
      }

      // Top 10 procedimientos por cantidad (sin desempate en el SQL del servicio).
      const porCodigo = new Map<string, number>();
      for (const f of filas) porCodigo.set(f.code, (porCodigo.get(f.code) ?? 0) + f.quantity);
      const topApi = comoArreglo(data.topProcedimientos).map(comoRegistro);
      verificarTopN(
        topApi.map((f) => ({ clave: comoTexto(f.code), valor: comoNumero(f.quantity) })),
        porCodigo,
        10,
      );
      const codigosTop = topApi.map((f) => comoTexto(f.code));
      if (codigosTop.length > 0) {
        const nombres = await prismaE2E().procedure.findMany({ where: { code: { in: codigosTop } } });
        const nombrePorCodigo = new Map(nombres.map((p) => [p.code, p.name]));
        for (const fila of topApi) {
          expect(fila.name).toBe(nombrePorCodigo.get(comoTexto(fila.code)) ?? null);
        }
      }

      // Serie diaria: solo dias CON al menos una linea (sin huecos rellenados).
      const porDia = new Map<string, { lines: number; quantity: number }>();
      for (const f of filas) {
        const dia = diaBogota(f.providedAt);
        const actual = porDia.get(dia) ?? { lines: 0, quantity: 0 };
        actual.lines += 1;
        actual.quantity += f.quantity;
        porDia.set(dia, actual);
      }
      const serieApi = comoArreglo(data.serieDiaria).map(comoRegistro);
      expect(serieApi.map((f) => comoTexto(f.day)).sort()).toEqual([...porDia.keys()].sort());
      for (const fila of serieApi) {
        const esperado = porDia.get(comoTexto(fila.day));
        expect(comoNumero(fila.lines)).toBe(esperado?.lines ?? 0);
        expect(comoNumero(fila.quantity)).toBe(esperado?.quantity ?? 0);
      }
    }, 30_000);
  });

  describe('GET /analytics/triage', () => {
    it.each([
      ['periodo por defecto', false],
      ['periodo explicito', true],
    ] as const)('%s: distribucion por nivel/clasificacion, perfil horario y espera por nivel', async (etiqueta, explicito) => {
      const periodoParam = explicito ? periodoExplicito() : undefined;
      const periodo = periodoParam ?? periodoPorDefecto();
      const r = await medir(`triage:${etiqueta}`, () => director.get(`${PREFIJO}/analytics/triage${query(periodoParam)}`));
      expect(r.status).toBe(200);
      const data = comoRegistro(comoRegistro(r.body).data);

      const triages = await prismaE2E().triage.findMany({
        where: { triagedAt: { gte: periodo.desde, lte: periodo.hasta } },
        select: { level: true, classification: true, triagedAt: true },
      });
      expect(triages.length).toBeGreaterThan(0);

      const porNivel = new Map<string, number>();
      for (const t of triages) porNivel.set(String(t.level), (porNivel.get(String(t.level)) ?? 0) + 1);
      const nivelApi = comoArreglo(data.porNivel).map(comoRegistro);
      expect(nivelApi).toHaveLength(porNivel.size);
      for (const fila of nivelApi) {
        const clave = fila.level === null ? 'null' : String(comoNumero(fila.level));
        expect(comoNumero(fila.n)).toBe(porNivel.get(clave) ?? 0);
      }

      const porClasificacion = new Map<string, number>();
      for (const t of triages) porClasificacion.set(t.classification, (porClasificacion.get(t.classification) ?? 0) + 1);
      const clasificacionApi = comoArreglo(data.porClasificacion).map(comoRegistro);
      verificarTopN(
        clasificacionApi.map((f) => ({ clave: comoTexto(f.classification), valor: comoNumero(f.n) })),
        porClasificacion,
        15,
      );

      const porHora = new Map<number, number>();
      for (const t of triages) {
        const h = horaBogota(t.triagedAt);
        porHora.set(h, (porHora.get(h) ?? 0) + 1);
      }
      const horaApi = comoArreglo(data.perfilHorario).map(comoRegistro);
      for (const fila of horaApi) expect(comoNumero(fila.n)).toBe(porHora.get(comoNumero(fila.hour)) ?? 0);

      // Espera por nivel: reusa el MISMO calculo (independiente) que dashboard.e2e.test.ts,
      // pero filtrando por `admittedAt` (la tabla real que consulta wait-time.service).
      const admisiones = await prismaE2E().admission.findMany({
        where: {
          admittedAt: { gte: periodo.desde, lte: periodo.hasta },
          waitMinutes: { not: null },
          triageLevel: { not: null },
        },
        select: { waitMinutes: true, triageLevel: true },
      });
      const esperaPorNivel = new Map<number, number[]>();
      for (const a of admisiones) {
        const lista = esperaPorNivel.get(a.triageLevel as number) ?? [];
        lista.push(a.waitMinutes as number);
        esperaPorNivel.set(a.triageLevel as number, lista);
      }
      for (const lista of esperaPorNivel.values()) lista.sort((x, y) => x - y);
      const esperaApi = comoArreglo(data.esperaPorNivel).map(comoRegistro);
      expect(esperaApi).toHaveLength(esperaPorNivel.size);
      for (const fila of esperaApi) {
        const valores = esperaPorNivel.get(comoNumero(fila.level)) ?? [];
        expect(comoNumero(fila.n)).toBe(valores.length);
        expect(comoNumero(fila.p50)).toBeCloseTo(percentilContinuo(valores, 0.5), 2);
        expect(comoNumero(fila.p90)).toBeCloseTo(percentilContinuo(valores, 0.9), 2);
      }
    }, 30_000);
  });

  describe('exportacion CSV', () => {
    it('ANALISTA -> 403 en ambos exports (sin analytics:export); 200 en services/triage', async () => {
      expect((await analista.get(`${PREFIJO}/analytics/services`)).status).toBe(200);
      expect((await analista.get(`${PREFIJO}/analytics/triage`)).status).toBe(200);
      expect((await analista.get(`${PREFIJO}/analytics/services/export`)).status).toBe(403);
      expect((await analista.get(`${PREFIJO}/analytics/triage/export`)).status).toBe(403);
    });

    it('services/export: CSV identico al JSON (mismo periodo), cabeceras correctas y auditoria data.export', async () => {
      const periodo = periodoExplicito();
      const q = query(periodo);
      const [json, csv] = await Promise.all([
        director.get(`${PREFIJO}/analytics/services${q}`),
        medir('services/export', () => director.get(`${PREFIJO}/analytics/services/export${q}`)),
      ]);
      expect(json.status).toBe(200);
      expect(csv.status).toBe(200);
      expect(csv.headers.get('content-type')).toContain('text/csv');
      expect(csv.headers.get('content-disposition')).toContain('attachment');
      expect(csv.headers.get('content-disposition')).toContain('.csv');

      const texto = comoTexto(csv.body);
      const filas = parsearCsv(texto);
      const [cabecera, ...cuerpo] = filas;
      expect(cabecera).toEqual(['area', 'specialty', 'lines', 'quantity']);

      const porAreaEspecialidad = comoArreglo(comoRegistro(comoRegistro(json.body).data).porAreaEspecialidad).map(comoRegistro);
      expect(cuerpo).toHaveLength(porAreaEspecialidad.length);
      cuerpo.forEach((celdas, i) => {
        const esperado = porAreaEspecialidad[i];
        if (!esperado) throw new Error(`fila ${i} inesperada en el CSV`);
        verificarCeldaSegura(celdas[0] ?? '', String(esperado.area));
        verificarCeldaSegura(celdas[1] ?? '', String(esperado.specialty));
        expect(celdas[2]).toBe(String(esperado.lines));
        expect(celdas[3]).toBe(String(esperado.quantity));
      });

      const requestId = csv.headers.get('x-request-id');
      expect(requestId).toBeTruthy();
      const auditoria = await prismaE2E().auditLog.findFirst({ where: { requestId, action: 'data.export' } });
      expect(auditoria, 'fila de auditoria data.export para esta descarga').toBeTruthy();
      expect(comoRegistro(auditoria?.metadata).report).toBe('analytics.services');
      expect(comoRegistro(auditoria?.metadata).filas).toBe(porAreaEspecialidad.length);
    });

    it('triage/export: CSV identico al JSON (mismo periodo) y auditoria data.export', async () => {
      const periodo = periodoExplicito();
      const q = query(periodo);
      const [json, csv] = await Promise.all([
        director.get(`${PREFIJO}/analytics/triage${q}`),
        medir('triage/export', () => director.get(`${PREFIJO}/analytics/triage/export${q}`)),
      ]);
      expect(json.status).toBe(200);
      expect(csv.status).toBe(200);
      expect(csv.headers.get('content-type')).toContain('text/csv');

      const filas = parsearCsv(comoTexto(csv.body));
      const [cabecera, ...cuerpo] = filas;
      expect(cabecera).toEqual(['level', 'n', 'p50', 'p90', 'avg']);

      const esperaPorNivel = comoArreglo(comoRegistro(comoRegistro(json.body).data).esperaPorNivel).map(comoRegistro);
      expect(cuerpo).toHaveLength(esperaPorNivel.length);
      cuerpo.forEach((celdas, i) => {
        const esperado = esperaPorNivel[i];
        if (!esperado) throw new Error(`fila ${i} inesperada en el CSV`);
        expect(celdas[0]).toBe(String(esperado.level));
        expect(celdas[1]).toBe(String(esperado.n));
        expect(celdas[2]).toBe(String(esperado.p50));
        expect(celdas[3]).toBe(String(esperado.p90));
        expect(celdas[4]).toBe(String(esperado.avg));
      });

      const requestId = csv.headers.get('x-request-id');
      const auditoria = await prismaE2E().auditLog.findFirst({ where: { requestId, action: 'data.export' } });
      expect(auditoria, 'fila de auditoria data.export para esta descarga').toBeTruthy();
      expect(comoRegistro(auditoria?.metadata).report).toBe('analytics.triage');
    });
  });

  describe('tiempos de respuesta (< 1s esperado en E2E; se mide y reporta)', () => {
    it('todas las llamadas medidas responden en menos de 3s (margen por CPU compartida)', () => {
      expect(Object.keys(tiempos).length).toBeGreaterThan(0);
      for (const [etiqueta, ms] of Object.entries(tiempos)) {
        expect(ms, `${etiqueta} tardo ${ms}ms`).toBeLessThan(3000);
      }
    });
  });
});
