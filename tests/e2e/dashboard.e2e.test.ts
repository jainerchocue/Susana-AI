import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { env } from '../../src/config/env';
import { Sesion, comoRol, credenciales, prismaE2E } from './cliente';

/**
 * T15 (ola E2): `/dashboard/*` cotejado con los datos HIS reales.
 *
 * E0: cada cifra se compara con un calculo propio de este archivo, hecho
 * SOLO con Prisma (nunca importando `src/modules/dashboard|analytics/*`).
 * La estrategia es distinta a la del servicio a proposito: el servicio agrega
 * con SQL (`$queryRaw`/`GROUP BY`); aqui se trae la tabla `his_admissions`
 * COMPLETA una vez (17.781 filas, cabe de sobra en memoria) y todo se agrega
 * en JS. Un bug de SQL en el servicio (p.ej. un limite mal puesto en un
 * BETWEEN) no se repetiria aqui: son dos caminos de calculo independientes.
 */

const BASE = inject('e2eUrl');
const PREFIJO = env.API_PREFIX;
const CINCO_HORAS_MS = 5 * 60 * 60 * 1000;
const UN_DIA_MS = 24 * 60 * 60 * 1000;
const SIETE_DIAS_MS = 7 * UN_DIA_MS;
const TREINTA_DIAS_MS = 30 * UN_DIA_MS;

// ── Helpers de forma (sin `any`, CLAUDE.md §11) ─────────────────────────────

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

/** `number | 'insufficient_data'`: el unico "escape" documentado del contrato numerico (B0). */
function numeroOInsuficiente(valor: unknown): number | 'insufficient_data' {
  if (valor === 'insufficient_data') return valor;
  return comoNumero(valor);
}

// ── Helpers de tiempo (Colombia, UTC-5 fijo, sin horario de verano — B0) ────

/** Dia calendario de Bogota (YYYY-MM-DD) de un instante UTC. */
function diaBogota(fecha: Date): string {
  return new Date(fecha.getTime() - CINCO_HORAS_MS).toISOString().slice(0, 10);
}

/** Hora local de Bogota (0-23) de un instante UTC. */
function horaBogota(fecha: Date): number {
  return new Date(fecha.getTime() - CINCO_HORAS_MS).getUTCHours();
}

/** Instante UTC de las 23:59:59 hora Bogota del dia dado (YYYY-MM-DD). */
function finDeDiaBogota(dia: string): Date {
  return new Date(`${dia}T23:59:59-05:00`);
}

/** Lista de dias (YYYY-MM-DD) entre dos etiquetas de dia, ambas inclusive. */
function diasEntre(desdeDia: string, hastaDia: string): string[] {
  const dias: string[] = [];
  let actual = desdeDia;
  while (actual <= hastaDia) {
    dias.push(actual);
    const [anio, mes, dia] = actual.split('-').map(Number);
    actual = new Date(Date.UTC(anio ?? 1970, (mes ?? 1) - 1, (dia ?? 1) + 1)).toISOString().slice(0, 10);
  }
  return dias;
}

/** Percentil continuo por interpolacion lineal: misma formula que `percentile_cont` de Postgres. */
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

interface AdmisionCotejo {
  admittedAt: Date;
  lastActivityAt: Date | null;
  unit: string;
  bedCode: string;
  virtualBed: boolean;
  waitMinutes: number | null;
  triageLevel: number | null;
  entryRoute: string;
}

/** Camas fisicas DISTINTAS por unidad (capacidad). Es un hecho global, no depende del periodo. */
function camasFisicasPorUnidad(admisiones: AdmisionCotejo[]): Map<string, number> {
  const porUnidad = new Map<string, Set<string>>();
  for (const a of admisiones) {
    if (a.virtualBed) continue;
    const camas = porUnidad.get(a.unit) ?? new Set<string>();
    camas.add(a.bedCode);
    porUnidad.set(a.unit, camas);
  }
  return new Map([...porUnidad].map(([unidad, camas]) => [unidad, camas.size]));
}

interface CensoUnidad {
  census: number;
  virtualCensus: number;
}

/** Ingresos activos EN UN INSTANTE: admittedAt <= instante <= (lastActivityAt ?? admittedAt), agrupados por unidad. */
function censoPorUnidadEnInstante(admisiones: AdmisionCotejo[], instante: Date): Map<string, CensoUnidad> {
  const t = instante.getTime();
  const porUnidad = new Map<string, CensoUnidad>();
  for (const a of admisiones) {
    const fin = (a.lastActivityAt ?? a.admittedAt).getTime();
    if (a.admittedAt.getTime() > t || fin < t) continue;
    const actual = porUnidad.get(a.unit) ?? { census: 0, virtualCensus: 0 };
    actual.census += 1;
    if (a.virtualBed) actual.virtualCensus += 1;
    porUnidad.set(a.unit, actual);
  }
  return porUnidad;
}

function censoTotalEnInstante(admisiones: AdmisionCotejo[], instante: Date): number {
  const t = instante.getTime();
  let total = 0;
  for (const a of admisiones) {
    const fin = (a.lastActivityAt ?? a.admittedAt).getTime();
    if (a.admittedAt.getTime() <= t && fin >= t) total += 1;
  }
  return total;
}

describe('T15: /dashboard/* cotejado con los datos HIS reales', () => {
  let director: Sesion;
  let consulta: Sesion;
  let admisiones: AdmisionCotejo[];
  let datosHasta: Date;
  let camasFisicasTotal: number;
  let camasPorUnidad: Map<string, number>;

  const tiempos: Record<string, number> = {};

  beforeAll(async () => {
    director = new Sesion(BASE);
    const login = await director.login(credenciales.director.email, credenciales.director.password);
    expect(login.status, 'login de director de prueba').toBe(200);

    consulta = await comoRol(BASE, 'CONSULTA');

    const filas = await prismaE2E().admission.findMany({
      select: {
        admittedAt: true,
        lastActivityAt: true,
        unit: true,
        bedCode: true,
        virtualBed: true,
        waitMinutes: true,
        triageLevel: true,
        entryRoute: true,
      },
    });
    admisiones = filas;
    expect(admisiones.length).toBeGreaterThan(0);

    // max(admittedAt) calculado en JS desde las filas ya traidas: un camino de
    // calculo distinto al `aggregate` que usa `fechaReferencia()` en el codigo.
    datosHasta = admisiones.reduce((max, a) => (a.admittedAt > max ? a.admittedAt : max), admisiones[0]!.admittedAt);

    camasPorUnidad = camasFisicasPorUnidad(admisiones);
    camasFisicasTotal = [...camasPorUnidad.values()].reduce((acc, n) => acc + n, 0);
  }, 60_000);

  afterAll(async () => {
    await prismaE2E().$disconnect();
  });

  /** Periodo explicito, bien dentro de la ventana real de datos (2026-05-01..2026-09-22, B0). */
  function periodoExplicito(): { desde: Date; hasta: Date } {
    return { desde: new Date(datosHasta.getTime() - 14 * UN_DIA_MS), hasta: new Date(datosHasta.getTime() - 3 * UN_DIA_MS) };
  }

  function query(params?: Record<string, string>): string {
    if (!params) return '';
    return `?${new URLSearchParams(params).toString()}`;
  }

  async function medir<T>(etiqueta: string, accion: () => Promise<T>): Promise<T> {
    const inicio = Date.now();
    const resultado = await accion();
    tiempos[etiqueta] = Date.now() - inicio;
    return resultado;
  }

  describe('validacion de query (comun a los 4 endpoints: mismo periodoQuerySchema)', () => {
    it('desde > hasta -> 422', async () => {
      const r = await director.get(`${PREFIJO}/dashboard/summary${query({ desde: '2026-09-20', hasta: '2026-09-01' })}`);
      expect(r.status).toBe(422);
      expect(comoRegistro(comoRegistro(r.body).error).code).toBe('VALIDATION_ERROR');
    });

    it('rango > 366 dias -> 422', async () => {
      const r = await director.get(`${PREFIJO}/dashboard/summary${query({ desde: '2020-01-01', hasta: '2026-09-21' })}`);
      expect(r.status).toBe(422);
    });

    it('parametro desconocido -> 422 (schema .strict())', async () => {
      const r = await director.get(`${PREFIJO}/dashboard/occupancy${query({ unidad: 'URGENCIAS' })}`);
      expect(r.status).toBe(422);
    });

    it('fecha invalida -> 422', async () => {
      const r = await director.get(`${PREFIJO}/dashboard/wait-times${query({ desde: 'no-es-una-fecha' })}`);
      expect(r.status).toBe(422);
    });

    it('sin sesion -> 401 en los 4 endpoints', async () => {
      const anonimo = new Sesion(BASE);
      for (const ruta of ['summary', 'occupancy', 'wait-times', 'demand']) {
        const r = await anonimo.get(`${PREFIJO}/dashboard/${ruta}`);
        expect(r.status, ruta).toBe(401);
      }
    });
  });

  describe('GET /dashboard/summary', () => {
    it.each([
      ['periodo por defecto (30 dias)', false],
      ['periodo explicito', true],
    ] as const)('%s: ingresos, ocupacion global y espera p50 cotejados', async (etiqueta, explicito) => {
      // `periodoExplicito()` depende de `datosHasta` (lo llena `beforeAll`): no
      // se puede calcular dentro del arreglo de `it.each`, que vitest evalua al
      // DESCRIBIR los tests, antes de que corra ningun `beforeAll`.
      const periodo = explicito ? periodoExplicito() : undefined;
      const params = periodo ? { desde: periodo.desde.toISOString(), hasta: periodo.hasta.toISOString() } : undefined;
      const r = await medir(`summary:${etiqueta}`, () => director.get(`${PREFIJO}/dashboard/summary${query(params)}`));
      expect(r.status).toBe(200);
      const data = comoRegistro(comoRegistro(r.body).data);

      expect(comoTexto(data.datosHasta)).toBe(datosHasta.toISOString());
      const periodoResp = comoRegistro(data.periodo);
      const hastaEsperado = periodo ? periodo.hasta : datosHasta;
      const desdeEsperado = periodo ? periodo.desde : new Date(datosHasta.getTime() - TREINTA_DIAS_MS);
      expect(comoTexto(periodoResp.hasta)).toBe(hastaEsperado.toISOString());
      expect(comoTexto(periodoResp.desde)).toBe(desdeEsperado.toISOString());

      // Ingresos: conteo propio con `filter` sobre las filas ya cargadas (gte/lte, ambos inclusive).
      const enRango = (desde: Date, hasta: Date) =>
        admisiones.filter((a) => a.admittedAt.getTime() >= desde.getTime() && a.admittedAt.getTime() <= hasta.getTime())
          .length;
      const admissions = comoRegistro(data.admissions);
      expect(comoNumero(admissions.periodo)).toBe(enRango(desdeEsperado, hastaEsperado));
      expect(comoNumero(admissions.last24h)).toBe(enRango(new Date(datosHasta.getTime() - UN_DIA_MS), datosHasta));
      expect(comoNumero(admissions.last7d)).toBe(enRango(new Date(datosHasta.getTime() - SIETE_DIAS_MS), datosHasta));

      // Ocupacion global en el instante `datosHasta`, sumando todas las unidades.
      const censoGlobal = censoTotalEnInstante(admisiones, datosHasta);
      const occupancy = comoRegistro(data.occupancy);
      expect(comoNumero(occupancy.census)).toBe(censoGlobal);
      expect(comoNumero(occupancy.physicalBeds)).toBe(camasFisicasTotal);
      expect(occupancy.occupancyPct).toBeCloseTo((censoGlobal / camasFisicasTotal) * 100, 6);
      expect(occupancy.metodo).toBe('censo_estimado_ultima_actividad');

      // Espera p50 (7 dias hasta `datosHasta`, SIEMPRE fijo a datosHasta, no al periodo pedido).
      const esperaSemana = admisiones
        .filter(
          (a) =>
            a.waitMinutes !== null &&
            a.admittedAt.getTime() >= datosHasta.getTime() - SIETE_DIAS_MS &&
            a.admittedAt.getTime() <= datosHasta.getTime(),
        )
        .map((a) => a.waitMinutes as number)
        .sort((x, y) => x - y);
      expect(esperaSemana.length).toBeGreaterThan(0);
      expect(comoNumero(data.waitTimeP50Minutes)).toBeCloseTo(percentilContinuo(esperaSemana, 0.5), 2);

      // Alertas abiertas por severidad: DIRECTOR ve los 4 ambitos (tiene
      // services/surgeries/medications.read == ALERT_SCOPES completo, sin
      // filtrar ninguno). E0: "nunca asumas un conteo global de alertas": NO
      // se asume cero (T15 no evalua alertas, pero la tabla no es de uso
      // exclusivo garantizado); se coteja contra un conteo propio de OPEN por
      // severidad en el instante de la consulta.
      const abiertas = await prismaE2E().alert.groupBy({
        by: ['severity'],
        where: { status: 'OPEN' },
        _count: { severity: true },
      });
      const esperado: Record<string, number> = { WARNING: 0, CRITICAL: 0 };
      for (const g of abiertas) esperado[g.severity] = g._count.severity;
      const alerts = comoRegistro(data.alerts);
      expect(alerts).toEqual(esperado);
    });

    it('CONSULTA: 200, pero SIN bloque `alerts` (ningun ambito visible: sin services/medications/surgeries.read)', async () => {
      const r = await consulta.get(`${PREFIJO}/dashboard/summary`);
      expect(r.status).toBe(200);
      const data = comoRegistro(comoRegistro(r.body).data);
      expect(data.alerts).toBeUndefined();
      // El resto del cuerpo (ingresos, ocupacion) no depende del rol: sigue presente.
      expect(comoRegistro(data.occupancy).metodo).toBe('censo_estimado_ultima_actividad');
    });
  });

  describe('GET /dashboard/occupancy (dashboard.read + services.read)', () => {
    it('CONSULTA -> 403 (no tiene services.read)', async () => {
      const r = await consulta.get(`${PREFIJO}/dashboard/occupancy`);
      expect(r.status).toBe(403);
    });

    it.each([
      ['periodo por defecto', false],
      ['periodo explicito', true],
    ] as const)('%s: porUnidad y serieDiaria cotejados fila a fila', async (etiqueta, explicito) => {
      const periodo = explicito ? periodoExplicito() : undefined;
      const params = periodo ? { desde: periodo.desde.toISOString(), hasta: periodo.hasta.toISOString() } : undefined;
      const r = await medir(`occupancy:${etiqueta}`, () => director.get(`${PREFIJO}/dashboard/occupancy${query(params)}`));
      expect(r.status).toBe(200);
      const data = comoRegistro(comoRegistro(r.body).data);
      expect(data.metodo).toBe('censo_estimado_ultima_actividad');

      const censoPorUnidad = censoPorUnidadEnInstante(admisiones, datosHasta);
      const unidadesEsperadas = new Set([...camasPorUnidad.keys(), ...censoPorUnidad.keys()]);
      const porUnidad = comoArreglo(data.porUnidad).map(comoRegistro);
      expect(porUnidad).toHaveLength(unidadesEsperadas.size);

      let algunaInsuficiente = false;
      let algunaSobrecupo = false;
      for (const fila of porUnidad) {
        const unidad = comoTexto(fila.unit);
        expect(unidadesEsperadas.has(unidad), `unidad inesperada: ${unidad}`).toBe(true);
        const beds = camasPorUnidad.get(unidad) ?? 0;
        const censo = censoPorUnidad.get(unidad) ?? { census: 0, virtualCensus: 0 };
        expect(comoNumero(fila.physicalBeds)).toBe(beds);
        expect(comoNumero(fila.census)).toBe(censo.census);
        expect(comoNumero(fila.virtualCensus)).toBe(censo.virtualCensus);
        if (beds === 0) {
          expect(fila.occupancyPct).toBe('insufficient_data');
          algunaInsuficiente = true;
        } else {
          const pct = numeroOInsuficiente(fila.occupancyPct);
          expect(pct).toBeCloseTo((censo.census / beds) * 100, 6);
          if (typeof pct === 'number' && pct > 100) algunaSobrecupo = true;
        }
      }
      // B0 (verificado con los datos reales): al menos una unidad por encima
      // del 100% ("colapsado a mas del 200%"). El caso "0 camas fisicas" es
      // una regla que el codigo soporta (arriba se verifica el valor SI
      // ocurre), pero en las 9 unidades reales del extracto NINGUNA tiene 0
      // camas fisicas (la mas pequeña, SALA PARTOS, tiene 6): no se exige que
      // ocurra, solo se deja constancia de si aparecio en esta corrida.
      void algunaInsuficiente;
      expect(algunaSobrecupo, 'se esperaba alguna unidad con ocupacion > 100%').toBe(true);

      // Serie diaria: mismos dias que el periodo (calendario Bogota) y mismo censo/ocupacion por dia,
      // incluido el ULTIMO dia: el censo de cada dia es siempre el de las 23:59:59
      // locales de ese dia, aunque `hasta` caiga a media tarde (arreglado en
      // `censoDiario`: el prefiltro de candidatos usaba `hasta` en vez del fin
      // del ultimo dia de la serie y subcontaba el ultimo dia).
      const desdeReal = periodo ? periodo.desde : new Date(datosHasta.getTime() - TREINTA_DIAS_MS);
      const hastaReal = periodo ? periodo.hasta : datosHasta;
      const diasEsperados = diasEntre(diaBogota(desdeReal), diaBogota(hastaReal));
      const serie = comoArreglo(data.serieDiaria).map(comoRegistro);
      expect(serie.map((f) => comoTexto(f.day))).toEqual(diasEsperados);
      for (const fila of serie) {
        const dia = comoTexto(fila.day);
        const censoDia = censoTotalEnInstante(admisiones, finDeDiaBogota(dia));
        expect(comoNumero(fila.census)).toBe(censoDia);
        if (camasFisicasTotal === 0) {
          expect(fila.occupancyPct).toBe('insufficient_data');
        } else {
          expect(numeroOInsuficiente(fila.occupancyPct)).toBeCloseTo((censoDia / camasFisicasTotal) * 100, 6);
        }
      }
    });

    it('serieDiaria del ULTIMO dia de un periodo explicito cuenta el censo completo a las 23:59:59, no solo hasta `hasta`', async () => {
      const { desde: desdeReal, hasta: hastaReal } = periodoExplicito();
      const r = await director.get(
        `${PREFIJO}/dashboard/occupancy${query({ desde: desdeReal.toISOString(), hasta: hastaReal.toISOString() })}`,
      );
      expect(r.status).toBe(200);
      const data = comoRegistro(comoRegistro(r.body).data);
      const serie = comoArreglo(data.serieDiaria).map(comoRegistro);
      const ultimoDia = diaBogota(hastaReal);
      const filaUltimoDia = serie.find((f) => comoTexto(f.day) === ultimoDia);
      expect(filaUltimoDia, `sin fila para el ultimo dia (${ultimoDia})`).toBeDefined();

      const censoEsperado = censoTotalEnInstante(admisiones, finDeDiaBogota(ultimoDia));
      expect(comoNumero(filaUltimoDia?.census)).toBe(censoEsperado);
    });
  });

  describe('GET /dashboard/wait-times (dashboard.read + services.read)', () => {
    it('CONSULTA -> 403', async () => {
      const r = await consulta.get(`${PREFIJO}/dashboard/wait-times`);
      expect(r.status).toBe(403);
    });

    it.each([
      ['periodo por defecto', false],
      ['periodo explicito', true],
    ] as const)('%s: p50/p90/avg por nivel y serie diaria de p50', async (etiqueta, explicito) => {
      const periodo = explicito ? periodoExplicito() : undefined;
      const params = periodo ? { desde: periodo.desde.toISOString(), hasta: periodo.hasta.toISOString() } : undefined;
      const r = await medir(`wait-times:${etiqueta}`, () => director.get(`${PREFIJO}/dashboard/wait-times${query(params)}`));
      expect(r.status).toBe(200);
      const data = comoRegistro(comoRegistro(r.body).data);

      const desdeReal = periodo ? periodo.desde : new Date(datosHasta.getTime() - TREINTA_DIAS_MS);
      const hastaReal = periodo ? periodo.hasta : datosHasta;
      const enPeriodo = admisiones.filter(
        (a) =>
          a.waitMinutes !== null &&
          a.triageLevel !== null &&
          a.admittedAt.getTime() >= desdeReal.getTime() &&
          a.admittedAt.getTime() <= hastaReal.getTime(),
      );
      const porNivel = new Map<number, number[]>();
      for (const a of enPeriodo) {
        const lista = porNivel.get(a.triageLevel as number) ?? [];
        lista.push(a.waitMinutes as number);
        porNivel.set(a.triageLevel as number, lista);
      }
      for (const lista of porNivel.values()) lista.sort((x, y) => x - y);

      const filas = comoArreglo(data.porNivel).map(comoRegistro);
      expect(filas).toHaveLength(porNivel.size);
      for (const fila of filas) {
        const nivel = comoNumero(fila.level);
        const valores = porNivel.get(nivel);
        expect(valores, `sin datos propios para el nivel ${nivel}`).toBeDefined();
        const v = valores ?? [];
        expect(comoNumero(fila.n)).toBe(v.length);
        expect(comoNumero(fila.p50)).toBeCloseTo(percentilContinuo(v, 0.5), 2);
        expect(comoNumero(fila.p90)).toBeCloseTo(percentilContinuo(v, 0.9), 2);
        expect(comoNumero(fila.avg)).toBeCloseTo(v.reduce((a, b) => a + b, 0) / v.length, 2);
      }

      // Serie diaria de p50 (todos los niveles juntos, agrupado por dia calendario Bogota).
      const porDia = new Map<string, number[]>();
      for (const a of admisiones) {
        if (a.waitMinutes === null) continue;
        if (a.admittedAt.getTime() < desdeReal.getTime() || a.admittedAt.getTime() > hastaReal.getTime()) continue;
        const dia = diaBogota(a.admittedAt);
        const lista = porDia.get(dia) ?? [];
        lista.push(a.waitMinutes);
        porDia.set(dia, lista);
      }
      const diasEsperados = diasEntre(diaBogota(desdeReal), diaBogota(hastaReal));
      const serie = comoArreglo(data.serieDiaria).map(comoRegistro);
      expect(serie.map((f) => comoTexto(f.day))).toEqual(diasEsperados);

      // Incluye el primer y el ultimo dia: `p50Diario` acota el JOIN a
      // [desde,hasta] igual que `esperaPorNivel`/`ingresosPorDiaYUnidad`, asi
      // que un dia calendario parcial (el primero o el ultimo del periodo) ya
      // no arrastra ingresos de fuera del rango exacto.
      for (const fila of serie) {
        const dia = comoTexto(fila.day);
        const valores = (porDia.get(dia) ?? []).slice().sort((x, y) => x - y);
        expect(comoNumero(fila.n)).toBe(valores.length);
        if (valores.length === 0) {
          expect(fila.p50).toBe('insufficient_data');
        } else {
          expect(comoNumero(fila.p50)).toBeCloseTo(percentilContinuo(valores, 0.5), 2);
        }
      }
    });

    it('serieDiaria del PRIMER dia del periodo por defecto no incluye ingresos anteriores a `desde`', async () => {
      const desdeReal = new Date(datosHasta.getTime() - TREINTA_DIAS_MS);
      const hastaReal = datosHasta;
      const r = await director.get(`${PREFIJO}/dashboard/wait-times`);
      expect(r.status).toBe(200);
      const data = comoRegistro(comoRegistro(r.body).data);
      const serie = comoArreglo(data.serieDiaria).map(comoRegistro);
      const primerDia = diaBogota(desdeReal);
      const filaPrimerDia = serie.find((f) => comoTexto(f.day) === primerDia);
      expect(filaPrimerDia, `sin fila para el primer dia (${primerDia})`).toBeDefined();

      const esperadoExacto = admisiones.filter(
        (a) =>
          a.waitMinutes !== null &&
          diaBogota(a.admittedAt) === primerDia &&
          a.admittedAt.getTime() >= desdeReal.getTime() &&
          a.admittedAt.getTime() <= hastaReal.getTime(),
      ).length;
      expect(comoNumero(filaPrimerDia?.n)).toBe(esperadoExacto);
    });

    it('serieDiaria del ULTIMO dia de un periodo explicito no incluye ingresos posteriores a `hasta`', async () => {
      const { desde: desdeReal, hasta: hastaReal } = periodoExplicito();
      const r = await director.get(
        `${PREFIJO}/dashboard/wait-times${query({ desde: desdeReal.toISOString(), hasta: hastaReal.toISOString() })}`,
      );
      expect(r.status).toBe(200);
      const data = comoRegistro(comoRegistro(r.body).data);
      const serie = comoArreglo(data.serieDiaria).map(comoRegistro);
      const ultimoDia = diaBogota(hastaReal);
      const filaUltimoDia = serie.find((f) => comoTexto(f.day) === ultimoDia);
      expect(filaUltimoDia, `sin fila para el ultimo dia (${ultimoDia})`).toBeDefined();

      const esperadoExacto = admisiones.filter(
        (a) =>
          a.waitMinutes !== null &&
          diaBogota(a.admittedAt) === ultimoDia &&
          a.admittedAt.getTime() >= desdeReal.getTime() &&
          a.admittedAt.getTime() <= hastaReal.getTime(),
      ).length;
      expect(comoNumero(filaUltimoDia?.n)).toBe(esperadoExacto);
    });
  });

  describe('GET /dashboard/demand (dashboard.read + services.read)', () => {
    it('CONSULTA -> 403', async () => {
      const r = await consulta.get(`${PREFIJO}/dashboard/demand`);
      expect(r.status).toBe(403);
    });

    it.each([
      ['periodo por defecto', false],
      ['periodo explicito', true],
    ] as const)('%s: por dia/unidad, por via, perfil horario y demandChangePct', async (etiqueta, explicito) => {
      const periodo = explicito ? periodoExplicito() : undefined;
      const params = periodo ? { desde: periodo.desde.toISOString(), hasta: periodo.hasta.toISOString() } : undefined;
      const r = await medir(`demand:${etiqueta}`, () => director.get(`${PREFIJO}/dashboard/demand${query(params)}`));
      expect(r.status).toBe(200);
      const data = comoRegistro(comoRegistro(r.body).data);

      const desdeReal = periodo ? periodo.desde : new Date(datosHasta.getTime() - TREINTA_DIAS_MS);
      const hastaReal = periodo ? periodo.hasta : datosHasta;
      const enPeriodo = admisiones.filter(
        (a) => a.admittedAt.getTime() >= desdeReal.getTime() && a.admittedAt.getTime() <= hastaReal.getTime(),
      );

      // Por dia y unidad: comparacion ORDENADA (dia,unidad es clave completa: sin empates posibles).
      const porDiaUnidad = new Map<string, number>();
      for (const a of enPeriodo) {
        const clave = `${diaBogota(a.admittedAt)}|${a.unit}`;
        porDiaUnidad.set(clave, (porDiaUnidad.get(clave) ?? 0) + 1);
      }
      const filasDiaUnidad = comoArreglo(data.porDiaYUnidad).map(comoRegistro);
      const totalDiaUnidad = filasDiaUnidad.reduce((acc, f) => acc + comoNumero(f.n), 0);
      expect(totalDiaUnidad).toBe(enPeriodo.length);
      for (const fila of filasDiaUnidad) {
        const clave = `${comoTexto(fila.day)}|${comoTexto(fila.unit)}`;
        expect(comoNumero(fila.n)).toBe(porDiaUnidad.get(clave) ?? 0);
      }

      // Por via de ingreso: comparado como MAPA (sin orden), `ORDER BY n DESC`
      // sin desempate no garantiza un orden estable entre empates.
      const porVia = new Map<string, number>();
      for (const a of enPeriodo) porVia.set(a.entryRoute, (porVia.get(a.entryRoute) ?? 0) + 1);
      const filasVia = comoArreglo(data.porViaIngreso).map(comoRegistro);
      expect(filasVia).toHaveLength(porVia.size);
      for (const fila of filasVia) expect(comoNumero(fila.n)).toBe(porVia.get(comoTexto(fila.entryRoute)) ?? 0);

      // Perfil horario (0-23, Bogota): clave de agrupacion unica, sin empates que desambiguar.
      const porHora = new Map<number, number>();
      for (const a of enPeriodo) {
        const h = horaBogota(a.admittedAt);
        porHora.set(h, (porHora.get(h) ?? 0) + 1);
      }
      const filasHora = comoArreglo(data.perfilHorario).map(comoRegistro);
      for (const fila of filasHora) expect(comoNumero(fila.n)).toBe(porHora.get(comoNumero(fila.hour)) ?? 0);

      // demandChangePct: SIEMPRE relativo a `datosHasta` (no al periodo pedido): debe coincidir
      // en ambas corridas (defecto/explicito) porque el controlador ignora `hasta` aqui.
      const inicioUltimos7 = new Date(datosHasta.getTime() - SIETE_DIAS_MS);
      const inicioPrevios7 = new Date(inicioUltimos7.getTime() - SIETE_DIAS_MS);
      const last7PorUnidad = new Map<string, number>();
      const prev7PorUnidad = new Map<string, number>();
      for (const a of admisiones) {
        const t = a.admittedAt.getTime();
        if (t > inicioUltimos7.getTime() && t <= datosHasta.getTime()) {
          last7PorUnidad.set(a.unit, (last7PorUnidad.get(a.unit) ?? 0) + 1);
        } else if (t > inicioPrevios7.getTime() && t <= inicioUltimos7.getTime()) {
          prev7PorUnidad.set(a.unit, (prev7PorUnidad.get(a.unit) ?? 0) + 1);
        }
      }
      const unidadesCambio = new Set([...last7PorUnidad.keys(), ...prev7PorUnidad.keys()]);
      const filasCambio = comoArreglo(data.cambioPorUnidad).map(comoRegistro);
      expect(filasCambio).toHaveLength(unidadesCambio.size);
      let algunaInsuficienteDemanda = false;
      for (const fila of filasCambio) {
        const unidad = comoTexto(fila.unit);
        const last7 = last7PorUnidad.get(unidad) ?? 0;
        const prev7 = prev7PorUnidad.get(unidad) ?? 0;
        expect(comoNumero(fila.last7)).toBe(last7);
        expect(comoNumero(fila.prev7)).toBe(prev7);
        if (prev7 === 0) {
          expect(fila.changePct).toBe('insufficient_data');
          algunaInsuficienteDemanda = true;
        } else {
          expect(numeroOInsuficiente(fila.changePct)).toBeCloseTo(((last7 - prev7) / prev7) * 100, 6);
        }
      }
      // No se afirma que SIEMPRE exista una unidad con prev7=0 (a diferencia de la
      // ocupacion, B0 no lo garantiza para demanda): solo se registra el hallazgo.
      void algunaInsuficienteDemanda;
    });

    it('demandChangePct es el MISMO en ambas corridas (defecto y explicito): no depende del periodo pedido', async () => {
      const explicito = periodoExplicito();
      const [porDefecto, conPeriodo] = await Promise.all([
        director.get(`${PREFIJO}/dashboard/demand`),
        director.get(
          `${PREFIJO}/dashboard/demand${query({ desde: explicito.desde.toISOString(), hasta: explicito.hasta.toISOString() })}`,
        ),
      ]);
      expect(porDefecto.status).toBe(200);
      expect(conPeriodo.status).toBe(200);
      expect(comoRegistro(porDefecto.body).data).toMatchObject({
        cambioPorUnidad: comoRegistro(comoRegistro(conPeriodo.body).data).cambioPorUnidad,
      });
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
