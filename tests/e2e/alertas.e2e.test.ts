import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AlertStatus } from '@prisma/client';
import { env } from '../../src/config/env';
import { comoRol, prismaE2E, Sesion } from './cliente';

/**
 * T16 (ola E2): ciclo completo del motor de alertas sobre el proceso real y
 * los datos HIS reales (E0). El job de alertas del servidor evalua al
 * arrancar (el global setup ya vacio `alerts` antes de arrancarlo, E1), asi
 * que esta suite NUNCA asume que la tabla empieza vacia: cada asercion se
 * apoya en una evaluacion manual propia (`POST /alerts/evaluate`) y en una
 * segunda llamada idempotente para fijar un estado conocido, nunca en
 * conteos absolutos previos a esa llamada.
 *
 * Para LOW_STOCK usamos DOS medicamentos SINTETICOS (`ZE2EALERT1/2`, con una
 * unica dispensacion cada uno) que no existen en el HIS real: nos dan control
 * EXACTO del consumo medio (210/30 = 7/dia) para fijar la severidad sin
 * depender de cifras irregulares de codigos reales. Las demas metricas
 * (ocupacion, espera, demanda, cirugia) se leen tal cual estan en los datos
 * reales y se recalculan aqui con consultas propias, nunca con los servicios
 * de `src/`.
 *
 * Al terminar: borra las alertas y el stock/medicamento/dispensacion
 * sinteticos que este archivo toco. Nunca borra ni resuelve una alerta que no
 * haya creado (las de ocupacion/espera/demanda/cirugia son reales: solo se
 * leen, nunca se tocan).
 */

const BASE = inject('e2eUrl');
const PREFIJO = env.API_PREFIX;
const prisma = prismaE2E();

const CODIGO_A = 'ZE2EALERT1';
const CODIGO_B = 'ZE2EALERT2';
const ID_DISPENSACION_A = 900_200_001;
const ID_DISPENSACION_B = 900_200_002;
const CANTIDAD_DISPENSADA = 210; // avg = 210 / 30 dias = 7/dia exacto.
const CONSUMO_DIARIO = CANTIDAD_DISPENSADA / 30;
const STOCK_BAJO = 35; // dias = 35/7 = 5.0 -> WARNING (umbrales por defecto: <3 CRITICAL, <7 WARNING).
const STOCK_ALTO = 7_000; // dias = 1000.0, muy por encima de cualquier umbral.

// ─── Estrechado de tipos sobre JSON (CLAUDE.md §11: sin `any`) ─────────────

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

function comoTexto(valor: unknown): string {
  if (typeof valor !== 'string') throw new Error(`Se esperaba un texto; se recibio: ${JSON.stringify(valor)}`);
  return valor;
}

function comoNumero(valor: unknown): number {
  if (typeof valor !== 'number') throw new Error(`Se esperaba un numero; se recibio: ${JSON.stringify(valor)}`);
  return valor;
}

function comoTextoONulo(valor: unknown): string | null {
  return valor === null ? null : comoTexto(valor);
}

interface ResultadoEvaluacion {
  creadas: number;
  actualizadas: number;
  resueltas: number;
  evaluadoEn: string;
}

function comoResultadoEvaluacion(valor: unknown): ResultadoEvaluacion {
  const r = comoRegistro(valor);
  return {
    creadas: comoNumero(r.creadas),
    actualizadas: comoNumero(r.actualizadas),
    resueltas: comoNumero(r.resueltas),
    evaluadoEn: comoTexto(r.evaluadoEn),
  };
}

interface AlertaPublica {
  id: string;
  type: string;
  severity: string;
  status: string;
  scope: string;
  scopeId: string | null;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

function comoAlertaPublica(valor: unknown): AlertaPublica {
  const r = comoRegistro(valor);
  return {
    id: comoTexto(r.id),
    type: comoTexto(r.type),
    severity: comoTexto(r.severity),
    status: comoTexto(r.status),
    scope: comoTexto(r.scope),
    scopeId: comoTextoONulo(r.scopeId),
    metric: comoTexto(r.metric),
    value: comoNumero(r.value),
    threshold: comoNumero(r.threshold),
    message: comoTexto(r.message),
    acknowledgedAt: comoTextoONulo(r.acknowledgedAt),
    resolvedAt: comoTextoONulo(r.resolvedAt),
  };
}

// ─── Recalculo INDEPENDIENTE de las 4 metricas no-medicamento (E0: nunca se
// importan `occupancy.service.ts`/`wait-time.service.ts`/etc. de `src/`) ────

interface Candidato {
  type: string;
  scope: string;
  scopeId: string | null;
  severity: 'WARNING' | 'CRITICAL';
  value: number;
  threshold: number;
}

/** Replica del algoritmo de `percentile_cont` de Postgres: interpolacion lineal, rango 0-indexado = p*(n-1). */
function percentilContinuo(valores: number[], p: number): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const n = ordenados.length;
  if (n === 0) throw new Error('percentilContinuo sobre un arreglo vacio.');
  const rango = p * (n - 1);
  const indiceInferior = Math.floor(rango);
  const indiceSuperior = Math.ceil(rango);
  const valorInferior = ordenados[indiceInferior];
  const valorSuperior = ordenados[indiceSuperior];
  if (valorInferior === undefined || valorSuperior === undefined) {
    throw new Error('Indice fuera de rango en percentilContinuo (no deberia pasar).');
  }
  if (indiceInferior === indiceSuperior) return valorInferior;
  const fraccion = rango - indiceInferior;
  return valorInferior + (valorSuperior - valorInferior) * fraccion;
}

function redondear2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** "Por encima del maximo": CRITICAL si supera `critico` (si aplica), si no WARNING si supera `warning`. Comparacion ESTRICTA. */
function severidadSobreMaximo(valor: number, warning: number, critico: number | null): 'WARNING' | 'CRITICAL' | null {
  if (critico !== null && valor > critico) return 'CRITICAL';
  if (valor > warning) return 'WARNING';
  return null;
}

function severidadBajoMinimo(valor: number, warning: number, critico: number | null): 'WARNING' | 'CRITICAL' | null {
  if (critico !== null && valor < critico) return 'CRITICAL';
  if (valor < warning) return 'WARNING';
  return null;
}

/** Ocupacion por unidad EN el instante `referencia`: capacidad fisica (camas no virtuales) vs censo. */
async function candidatosOcupacion(referencia: Date): Promise<Candidato[]> {
  const admisiones = await prisma.admission.findMany({
    select: { unit: true, bedCode: true, virtualBed: true, admittedAt: true, lastActivityAt: true },
  });
  const capacidad = new Map<string, Set<string>>();
  const censo = new Map<string, number>();
  for (const a of admisiones) {
    if (!a.virtualBed) {
      const camas = capacidad.get(a.unit) ?? new Set<string>();
      camas.add(a.bedCode);
      capacidad.set(a.unit, camas);
    }
    const fin = a.lastActivityAt ?? a.admittedAt;
    if (a.admittedAt.getTime() <= referencia.getTime() && fin.getTime() >= referencia.getTime()) {
      censo.set(a.unit, (censo.get(a.unit) ?? 0) + 1);
    }
  }

  const candidatos: Candidato[] = [];
  for (const unidad of new Set([...capacidad.keys(), ...censo.keys()])) {
    const camas = capacidad.get(unidad)?.size ?? 0;
    if (camas === 0) continue; // insufficient_data: nunca genera alerta.
    const pct = ((censo.get(unidad) ?? 0) / camas) * 100;
    const severidad = severidadSobreMaximo(pct, env.ALERT_OCCUPANCY_PCT, env.ALERT_CRITICAL_OCCUPANCY_PCT);
    if (severidad) {
      candidatos.push({
        type: 'HIGH_OCCUPANCY',
        scope: 'service',
        scopeId: unidad,
        severity: severidad,
        value: pct,
        threshold: severidad === 'CRITICAL' ? env.ALERT_CRITICAL_OCCUPANCY_PCT : env.ALERT_OCCUPANCY_PCT,
      });
    }
  }
  return candidatos;
}

/** Mediana de espera por nivel de triage, en los `desde..hasta` (7 dias hasta la referencia, igual criterio que el motor). */
async function candidatosEspera(desde: Date, hasta: Date): Promise<Candidato[]> {
  const filas = await prisma.admission.findMany({
    where: { waitMinutes: { not: null }, triageLevel: { not: null }, admittedAt: { gte: desde, lte: hasta } },
    select: { triageLevel: true, waitMinutes: true },
  });
  const porNivel = new Map<number, number[]>();
  for (const f of filas) {
    if (f.triageLevel === null || f.waitMinutes === null) continue;
    const lista = porNivel.get(f.triageLevel) ?? [];
    lista.push(f.waitMinutes);
    porNivel.set(f.triageLevel, lista);
  }

  const candidatos: Candidato[] = [];
  for (const [nivel, valores] of porNivel) {
    const p50 = percentilContinuo(valores, 0.5);
    const severidad = severidadSobreMaximo(p50, env.ALERT_WAIT_MINUTES, env.ALERT_WAIT_MINUTES * 2);
    if (severidad) {
      candidatos.push({
        type: 'LONG_WAIT',
        scope: 'triage',
        scopeId: `nivel-${nivel}`,
        severity: severidad,
        value: p50,
        threshold: severidad === 'CRITICAL' ? env.ALERT_WAIT_MINUTES * 2 : env.ALERT_WAIT_MINUTES,
      });
    }
  }
  return candidatos;
}

/** Cambio de demanda por unidad: ingresos de los ultimos 7 dias frente a los 7 previos, ambos hasta `hasta`. */
async function candidatosDemanda(hasta: Date): Promise<Candidato[]> {
  const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
  const inicioUltimos7 = new Date(hasta.getTime() - SIETE_DIAS_MS);
  const inicioPrevios7 = new Date(inicioUltimos7.getTime() - SIETE_DIAS_MS);

  const filas = await prisma.admission.findMany({
    where: { admittedAt: { gt: inicioPrevios7, lte: hasta } },
    select: { unit: true, admittedAt: true },
  });
  const last7 = new Map<string, number>();
  const prev7 = new Map<string, number>();
  for (const f of filas) {
    const t = f.admittedAt.getTime();
    if (t > inicioUltimos7.getTime()) last7.set(f.unit, (last7.get(f.unit) ?? 0) + 1);
    else prev7.set(f.unit, (prev7.get(f.unit) ?? 0) + 1);
  }

  const candidatos: Candidato[] = [];
  for (const unidad of new Set([...last7.keys(), ...prev7.keys()])) {
    const p = prev7.get(unidad) ?? 0;
    if (p === 0) continue; // insufficient_data: division por cero no es "0% de cambio".
    const pct = (((last7.get(unidad) ?? 0) - p) / p) * 100;
    const severidad = severidadSobreMaximo(pct, env.ALERT_DEMAND_SPIKE_PCT, null);
    if (severidad) {
      candidatos.push({ type: 'DEMAND_SPIKE', scope: 'service', scopeId: unidad, severity: severidad, value: pct, threshold: env.ALERT_DEMAND_SPIKE_PCT });
    }
  }
  return candidatos;
}

/** % de cirugias verificables sin ejecucion registrada (redondeado a 2 decimales, igual que `surgeries.service.ts`). */
async function candidatosCirugia(): Promise<Candidato[]> {
  const [ejecutadas, noEjecutadas] = await Promise.all([
    prisma.surgerySchedule.count({ where: { executed: 'si' } }),
    prisma.surgerySchedule.count({ where: { executed: 'no' } }),
  ]);
  const verificable = ejecutadas + noEjecutadas;
  if (verificable === 0) return [];
  const pct = redondear2((noEjecutadas / verificable) * 100);
  const severidad = severidadSobreMaximo(pct, env.ALERT_SURGERY_CANCELLATION_PCT, null);
  if (!severidad) return [];
  return [{ type: 'SURGERY_CANCELLATIONS', scope: 'surgery', scopeId: null, severity: severidad, value: pct, threshold: env.ALERT_SURGERY_CANCELLATION_PCT }];
}

function claveDe(c: { type: string; scopeId: string | null }): string {
  return `${c.type}::${c.scopeId ?? ''}`;
}

/** Alertas OPEN/ACK actuales de cualquier ambito EXCEPTO medicamento (las de LOW_STOCK las controla este archivo aparte). */
async function alertasNoMedicamentoActuales(): Promise<Candidato[]> {
  const filas = await prisma.alert.findMany({
    where: { status: { in: [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED] }, type: { not: 'LOW_STOCK' } },
  });
  return filas.map((f) => ({
    type: f.type,
    scope: f.scope,
    scopeId: f.scopeId,
    severity: f.severity,
    value: f.value,
    threshold: f.threshold,
  }));
}

// ─── Setup del archivo ──────────────────────────────────────────────────────

let farmacia: Sesion;
let jefeServicio: Sesion;
let director: Sesion;
let referencia: Date;
let candidatosNoMedicamento: Candidato[];

async function limpiarSinteticos(): Promise<void> {
  await prisma.alert.deleteMany({ where: { scopeId: { in: [CODIGO_A, CODIGO_B] } } });
  await prisma.medicationStock.deleteMany({ where: { code: { in: [CODIGO_A, CODIGO_B] } } });
  await prisma.medicationDispense.deleteMany({ where: { id: { in: [ID_DISPENSACION_A, ID_DISPENSACION_B] } } });
  await prisma.medication.deleteMany({ where: { code: { in: [CODIGO_A, CODIGO_B] } } });
}

/**
 * Espera a que el conteo de alertas se estabilice: el job de alertas evalua
 * al arrancar el servidor (fuera de nuestro control, T11), en paralelo a nada
 * en particular. No es necesario para la CORRECCION de los asserts de este
 * archivo (la idempotencia se prueba con dos llamadas propias consecutivas,
 * nunca comparando contra un conteo previo a nuestra primera llamada), pero
 * reduce la ventana en la que esa evaluacion de arranque podria solaparse con
 * la nuestra (mismo tipo de carrera que el propio `ponytail` de
 * `alerts.service.ts` documenta sobre "un solo evaluador a la vez").
 */
async function esperarEvaluacionInicialEstable(): Promise<void> {
  let anterior = -1;
  for (let intento = 0; intento < 20; intento += 1) {
    const actual = await prisma.alert.count();
    if (actual === anterior) return;
    anterior = actual;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

beforeAll(async () => {
  [farmacia, jefeServicio, director] = await Promise.all([
    comoRol(BASE, 'FARMACIA'),
    comoRol(BASE, 'JEFE_SERVICIO'),
    comoRol(BASE, 'DIRECTOR'),
  ]);

  const maximo = await prisma.admission.aggregate({ _max: { admittedAt: true } });
  if (!maximo._max.admittedAt) throw new Error('No hay admisiones HIS importadas.');
  referencia = maximo._max.admittedAt;

  await limpiarSinteticos();

  const admisionCualquiera = await prisma.admission.findFirst({ select: { id: true }, orderBy: { id: 'asc' } });
  if (!admisionCualquiera) throw new Error('No hay ninguna admision HIS para enlazar las dispensaciones sinteticas.');

  const dispensadoEn = new Date(referencia.getTime() - 24 * 60 * 60 * 1000);
  await prisma.medication.createMany({
    data: [
      { code: CODIGO_A, name: 'MEDICAMENTO SINTETICO E2E ALERTA A', kind: 'medicamento' },
      { code: CODIGO_B, name: 'MEDICAMENTO SINTETICO E2E ALERTA B', kind: 'medicamento' },
    ],
  });
  await prisma.medicationDispense.createMany({
    data: [
      { id: ID_DISPENSACION_A, admissionId: admisionCualquiera.id, code: CODIGO_A, quantity: CANTIDAD_DISPENSADA, dispensedAt: dispensadoEn, area: 'FARMACIA', specialty: 'MEDICINA GENERAL' },
      { id: ID_DISPENSACION_B, admissionId: admisionCualquiera.id, code: CODIGO_B, quantity: CANTIDAD_DISPENSADA, dispensedAt: dispensadoEn, area: 'FARMACIA', specialty: 'MEDICINA GENERAL' },
    ],
  });

  await esperarEvaluacionInicialEstable();

  const desdeEspera = new Date(referencia.getTime() - 7 * 24 * 60 * 60 * 1000);
  candidatosNoMedicamento = [
    ...(await candidatosOcupacion(referencia)),
    ...(await candidatosEspera(desdeEspera, referencia)),
    ...(await candidatosDemanda(referencia)),
    ...(await candidatosCirugia()),
  ];
}, 60_000);

afterAll(async () => {
  await limpiarSinteticos();
  await prisma.$disconnect();
});

describe('POST /alerts/evaluate: permisos y cotejo con las metricas reales', () => {
  it('401 sin sesion', async () => {
    const r = await new Sesion(BASE).post(`${PREFIJO}/alerts/evaluate`);
    expect(r.status).toBe(401);
  });

  it('403 para DIRECTOR (alerts:read sin alerts:manage)', async () => {
    const r = await director.post(`${PREFIJO}/alerts/evaluate`);
    expect(r.status).toBe(403);
  });

  it('FARMACIA y JEFE_SERVICIO pueden evaluar; relanzar sin cambios no duplica nada', async () => {
    const primera = await farmacia.post(`${PREFIJO}/alerts/evaluate`);
    expect(primera.status).toBe(200);
    const resultado1 = comoResultadoEvaluacion(comoRegistro(primera.body).data);
    expect(resultado1.creadas).toBeGreaterThanOrEqual(0);
    expect(typeof resultado1.evaluadoEn).toBe('string');

    // Nada cambio entre las dos llamadas (los datos HIS son de solo lectura):
    // la segunda es puramente idempotente, sin importar lo que hizo la primera
    // (ni el job de arranque, cuyo momento exacto no controlamos).
    const segunda = await jefeServicio.post(`${PREFIJO}/alerts/evaluate`);
    expect(segunda.status).toBe(200);
    const resultado2 = comoResultadoEvaluacion(comoRegistro(segunda.body).data);
    expect(resultado2).toMatchObject({ creadas: 0, resueltas: 0, actualizadas: candidatosNoMedicamento.length });

    const rastro = await prisma.auditLog.findFirst({ where: { action: 'alert.evaluated' }, orderBy: { createdAt: 'desc' } });
    expect(rastro).not.toBeNull();
  });

  it('las alertas OPEN/ACK actuales cuadran EXACTAMENTE con ocupacion, espera, demanda y cirugia recalculadas aqui', async () => {
    const actuales = await alertasNoMedicamentoActuales();
    const actualesPorClave = new Map(actuales.map((a) => [claveDe(a), a]));

    expect(actualesPorClave.size).toBe(candidatosNoMedicamento.length);
    for (const esperado of candidatosNoMedicamento) {
      const real = actualesPorClave.get(claveDe(esperado));
      expect(real, `falta la alerta esperada ${claveDe(esperado)}`).toBeDefined();
      expect(real?.scope).toBe(esperado.scope);
      expect(real?.severity).toBe(esperado.severity);
      expect(real?.value).toBeCloseTo(esperado.value, 4);
      expect(real?.threshold).toBeCloseTo(esperado.threshold, 6);
    }

    // B0: la ocupacion real "colapsa a mas del 200%" en algunas unidades. Si
    // esto deja de cumplirse los datos cambiaron de forma que invalidaria el
    // resto de las suposiciones de este archivo sobre los datos reales.
    expect(candidatosNoMedicamento.some((c) => c.type === 'HIGH_OCCUPANCY' && c.severity === 'CRITICAL')).toBe(true);
  });
});

describe('Ciclo de LOW_STOCK: creacion, ambito, paginacion, resolucion automatica y manual', () => {
  it('poner stock bajo en los dos sinteticos y evaluar crea exactamente esas 2 alertas WARNING', async () => {
    const [rA, rB] = await Promise.all([
      farmacia.put(`${PREFIJO}/medications/${CODIGO_A}/stock`, { quantity: STOCK_BAJO }),
      farmacia.put(`${PREFIJO}/medications/${CODIGO_B}/stock`, { quantity: STOCK_BAJO }),
    ]);
    expect(rA.status).toBe(200);
    expect(rB.status).toBe(200);

    const r = await farmacia.post(`${PREFIJO}/alerts/evaluate`);
    expect(r.status).toBe(200);
    const resultado = comoResultadoEvaluacion(comoRegistro(r.body).data);
    expect(resultado).toMatchObject({ creadas: 2, resueltas: 0, actualizadas: candidatosNoMedicamento.length });

    const diasEsperados = STOCK_BAJO / CONSUMO_DIARIO;
    const severidadEsperada = severidadBajoMinimo(diasEsperados, env.ALERT_LOW_STOCK_DAYS, env.ALERT_CRITICAL_STOCK_DAYS);
    expect(severidadEsperada).toBe('WARNING');

    const filas = await prisma.alert.findMany({ where: { type: 'LOW_STOCK', scopeId: { in: [CODIGO_A, CODIGO_B] } } });
    expect(filas).toHaveLength(2);
    for (const fila of filas) {
      expect(fila.status).toBe(AlertStatus.OPEN);
      expect(fila.severity).toBe(severidadEsperada);
      expect(fila.value).toBeCloseTo(diasEsperados, 6);
      expect(fila.threshold).toBe(env.ALERT_LOW_STOCK_DAYS);
    }
  });

  it('relanzar sin cambios no duplica: sigue habiendo exactamente 2 filas LOW_STOCK', async () => {
    const r = await jefeServicio.post(`${PREFIJO}/alerts/evaluate`);
    expect(r.status).toBe(200);
    const resultado = comoResultadoEvaluacion(comoRegistro(r.body).data);
    expect(resultado).toMatchObject({ creadas: 0, resueltas: 0, actualizadas: candidatosNoMedicamento.length + 2 });

    const filas = await prisma.alert.findMany({ where: { type: 'LOW_STOCK', scopeId: { in: [CODIGO_A, CODIGO_B] } } });
    expect(filas).toHaveLength(2);
  });

  it('ambito: FARMACIA solo ve medication (scope=service vacio); DIRECTOR ve tambien las demas', async () => {
    const soloServicio = await farmacia.get(`${PREFIJO}/alerts?scope=service`);
    expect(soloServicio.status).toBe(200);
    expect(comoArreglo(comoRegistro(soloServicio.body).data)).toHaveLength(0);

    const medicamentoFarmacia = await farmacia.get(`${PREFIJO}/alerts?scope=medication&limit=100`);
    expect(medicamentoFarmacia.status).toBe(200);
    const itemsFarmacia = comoArreglo(comoRegistro(medicamentoFarmacia.body).data).map(comoAlertaPublica);
    expect(itemsFarmacia.length).toBeGreaterThanOrEqual(2);
    for (const item of itemsFarmacia) expect(item.scope).toBe('medication');
    expect(itemsFarmacia.some((i) => i.scopeId === CODIGO_A)).toBe(true);
    expect(itemsFarmacia.some((i) => i.scopeId === CODIGO_B)).toBe(true);

    const medicamentoDirector = await director.get(`${PREFIJO}/alerts?scope=medication&limit=100`);
    const itemsDirector = comoArreglo(comoRegistro(medicamentoDirector.body).data).map(comoAlertaPublica);
    expect(itemsDirector.some((i) => i.scopeId === CODIGO_A)).toBe(true);
  });

  it('GET /alerts/:id fuera de ambito responde 404 para FARMACIA (y 200 para DIRECTOR)', async () => {
    const fueraDeAmbito = await prisma.alert.findFirst({ where: { scope: { in: ['service', 'triage', 'surgery'] } } });
    if (!fueraDeAmbito) throw new Error('No hay ninguna alerta fuera de "medication" para probar el 404 por ambito.');

    const comoFarmacia = await farmacia.get(`${PREFIJO}/alerts/${fueraDeAmbito.id}`);
    expect(comoFarmacia.status).toBe(404);

    const comoDirector = await director.get(`${PREFIJO}/alerts/${fueraDeAmbito.id}`);
    expect(comoDirector.status).toBe(200);
  });

  it('un id inexistente (UUID valido) tambien responde 404, igual que uno fuera de ambito', async () => {
    const r = await farmacia.get(`${PREFIJO}/alerts/00000000-0000-4000-8000-000000000000`);
    expect(r.status).toBe(404);
  });

  it('paginacion por cursor: limit=1 dos veces trae las 2 alertas de medicamento sin repetir', async () => {
    const primera = await director.get(`${PREFIJO}/alerts?scope=medication&limit=1`);
    expect(primera.status).toBe(200);
    const cuerpo1 = comoRegistro(primera.body);
    const items1 = comoArreglo(cuerpo1.data).map(comoAlertaPublica);
    expect(items1).toHaveLength(1);
    const paginacion1 = comoRegistro(cuerpo1.pagination);
    expect(paginacion1.hasNext).toBe(true);
    const cursor = comoTexto(paginacion1.nextCursor);

    const segunda = await director.get(`${PREFIJO}/alerts?scope=medication&limit=1&cursor=${cursor}`);
    const cuerpo2 = comoRegistro(segunda.body);
    const items2 = comoArreglo(cuerpo2.data).map(comoAlertaPublica);
    expect(items2).toHaveLength(1);
    expect(comoRegistro(cuerpo2.pagination).hasNext).toBe(false);

    const [primeraAlerta] = items1;
    const [segundaAlerta] = items2;
    if (!primeraAlerta || !segundaAlerta) throw new Error('Paginas vacias (no deberia pasar tras el toHaveLength(1)).');
    expect(primeraAlerta.id).not.toBe(segundaAlerta.id);
    expect(new Set([primeraAlerta.scopeId, segundaAlerta.scopeId])).toEqual(new Set([CODIGO_A, CODIGO_B]));
  });

  it('status/severity/type invalidos en la query -> 422', async () => {
    const r = await farmacia.get(`${PREFIJO}/alerts?status=NO_EXISTE`);
    expect(r.status).toBe(422);
  });

  it('subir el stock de CODIGO_B y reevaluar la RESUELVE automaticamente (motor de reglas, no PATCH manual)', async () => {
    const put = await farmacia.put(`${PREFIJO}/medications/${CODIGO_B}/stock`, { quantity: STOCK_ALTO });
    expect(put.status).toBe(200);

    const alertaB = await prisma.alert.findFirstOrThrow({ where: { type: 'LOW_STOCK', scopeId: CODIGO_B } });
    expect(alertaB.status).toBe(AlertStatus.OPEN);

    const r = await jefeServicio.post(`${PREFIJO}/alerts/evaluate`);
    expect(r.status).toBe(200);
    const resultado = comoResultadoEvaluacion(comoRegistro(r.body).data);
    // CODIGO_A sigue con stock bajo (no se toco): sigue siendo candidato y se
    // "actualiza"; CODIGO_B ya no lo es: se resuelve. Nada nuevo se crea.
    expect(resultado).toMatchObject({ creadas: 0, resueltas: 1, actualizadas: candidatosNoMedicamento.length + 1 });

    const resuelta = await prisma.alert.findUniqueOrThrow({ where: { id: alertaB.id } });
    expect(resuelta.status).toBe(AlertStatus.RESOLVED);
    expect(resuelta.resolvedAt).not.toBeNull();

    const alertaA = await prisma.alert.findFirstOrThrow({ where: { type: 'LOW_STOCK', scopeId: CODIGO_A } });
    expect(alertaA.status).toBe(AlertStatus.OPEN);
  });
});

describe('PATCH /alerts/:id: transiciones de estado y auditoria (sobre CODIGO_A, la ultima accion de este archivo)', () => {
  it('con solo alerts:read (DIRECTOR) -> 403, sin cambiar el estado', async () => {
    const alerta = await prisma.alert.findFirstOrThrow({ where: { type: 'LOW_STOCK', scopeId: CODIGO_A } });
    const r = await director.patch(`${PREFIJO}/alerts/${alerta.id}`, { status: 'ACKNOWLEDGED' });
    expect(r.status).toBe(403);
    const sinCambios = await prisma.alert.findUniqueOrThrow({ where: { id: alerta.id } });
    expect(sinCambios.status).toBe(AlertStatus.OPEN);
  });

  it('un status desconocido en el body -> 422', async () => {
    const alerta = await prisma.alert.findFirstOrThrow({ where: { type: 'LOW_STOCK', scopeId: CODIGO_A } });
    const r = await farmacia.patch(`${PREFIJO}/alerts/${alerta.id}`, { status: 'BOGUS' });
    expect(r.status).toBe(422);
  });

  it('OPEN -> ACKNOWLEDGED -> RESOLVED, cada paso con su fila de auditoria', async () => {
    const alerta = await prisma.alert.findFirstOrThrow({ where: { type: 'LOW_STOCK', scopeId: CODIGO_A } });

    const aAck = await farmacia.patch(`${PREFIJO}/alerts/${alerta.id}`, { status: 'ACKNOWLEDGED' });
    expect(aAck.status).toBe(200);
    const publicaAck = comoAlertaPublica(comoRegistro(aAck.body).data);
    expect(publicaAck.status).toBe('ACKNOWLEDGED');
    expect(publicaAck.acknowledgedAt).not.toBeNull();

    const rastroAck = await prisma.auditLog.findFirst({
      where: { action: 'alert.updated', targetId: alerta.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(rastroAck?.metadata).toMatchObject({ from: 'OPEN', to: 'ACKNOWLEDGED' });

    const aResuelta = await farmacia.patch(`${PREFIJO}/alerts/${alerta.id}`, { status: 'RESOLVED' });
    expect(aResuelta.status).toBe(200);
    const publicaResuelta = comoAlertaPublica(comoRegistro(aResuelta.body).data);
    expect(publicaResuelta.status).toBe('RESOLVED');
    expect(publicaResuelta.resolvedAt).not.toBeNull();

    const rastroResuelta = await prisma.auditLog.findFirst({
      where: { action: 'alert.updated', targetId: alerta.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(rastroResuelta?.metadata).toMatchObject({ from: 'ACKNOWLEDGED', to: 'RESOLVED' });
  });

  it('RESOLVED -> ACKNOWLEDGED es una transicion invalida -> 409', async () => {
    const alerta = await prisma.alert.findFirstOrThrow({ where: { type: 'LOW_STOCK', scopeId: CODIGO_A } });
    expect(alerta.status).toBe(AlertStatus.RESOLVED);

    const r = await farmacia.patch(`${PREFIJO}/alerts/${alerta.id}`, { status: 'ACKNOWLEDGED' });
    expect(r.status).toBe(409);

    const sinCambios = await prisma.alert.findUniqueOrThrow({ where: { id: alerta.id } });
    expect(sinCambios.status).toBe(AlertStatus.RESOLVED);
  });
});
