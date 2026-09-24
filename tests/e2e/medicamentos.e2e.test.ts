import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { env } from '../../src/config/env';
import { comoRol, prismaE2E, Sesion } from './cliente';

/**
 * T16 (ola E2): medicamentos y stock, sobre el proceso real y los datos HIS
 * reales importados (E0). Nada de supertest ni de servicios de `src/`: cada
 * cifra se coteja con una consulta propia de este archivo contra
 * `prismaE2E()`, escrita desde cero.
 *
 * Este archivo NO llama a `/alerts/**`: eso es `alertas.e2e.test.ts`. Solo
 * toca `medication_stock` para un unico codigo SINTETICO (`ZE2ESTOCK1`, mas
 * su unica dispensacion sintetica) que no existe en el HIS real: nos da
 * control exacto sobre el consumo medio (210/30 = 7/dia) para probar los
 * umbrales de riesgo en su valor EXACTO, algo que los codigos reales no
 * garantizan por sus cifras irregulares. Al terminar, borra ese medicamento,
 * su dispensacion y su stock: deja `medication_stock` como lo encontro
 * (vacio) y no toca ningun dato HIS real.
 */

const BASE = inject('e2eUrl');
const PREFIJO = env.API_PREFIX;
const prisma = prismaE2E();

const CODIGO_SINTETICO = 'ZE2ESTOCK1';
const ID_DISPENSACION_SINTETICA = 900_100_001;
const CANTIDAD_DISPENSADA = 210; // avg = 210 / 30 dias = 7/dia exacto.
const CONSUMO_DIARIO_ESPERADO = CANTIDAD_DISPENSADA / 30;

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
  if (valor === null) return null;
  return comoTexto(valor);
}

function comoNumeroOInsuficiente(valor: unknown): number | 'insufficient_data' {
  if (valor === 'insufficient_data') return valor;
  return comoNumero(valor);
}

/** Item de `GET /medications`, ya con sus campos accedidos y comprobados en forma. */
interface ItemMedicamento {
  code: string;
  name: string;
  kind: string;
  quantity: number;
  lines: number;
  lastDispensedAt: string | null;
  stock: number | null;
  avgDailyConsumption: number | 'insufficient_data';
  daysOfInventory: number | 'insufficient_data';
  risk: string;
  rotation: string;
}

function comoItemMedicamento(valor: unknown): ItemMedicamento {
  const r = comoRegistro(valor);
  return {
    code: comoTexto(r.code),
    name: comoTexto(r.name),
    kind: comoTexto(r.kind),
    quantity: comoNumero(r.quantity),
    lines: comoNumero(r.lines),
    lastDispensedAt: comoTextoONulo(r.lastDispensedAt),
    stock: r.stock === null ? null : comoNumero(r.stock),
    avgDailyConsumption: comoNumeroOInsuficiente(r.avgDailyConsumption),
    daysOfInventory: comoNumeroOInsuficiente(r.daysOfInventory),
    risk: comoTexto(r.risk),
    rotation: comoTexto(r.rotation),
  };
}

interface PaginacionPagina {
  limit: number;
  total?: number;
  page?: number;
  totalPages?: number;
  hasNext: boolean;
  hasPrev?: boolean;
}

function comoPaginacion(valor: unknown): PaginacionPagina {
  const r = comoRegistro(valor);
  const paginacion: PaginacionPagina = { limit: comoNumero(r.limit), hasNext: r.hasNext === true };
  if (typeof r.total === 'number') paginacion.total = r.total;
  if (typeof r.page === 'number') paginacion.page = r.page;
  if (typeof r.totalPages === 'number') paginacion.totalPages = r.totalPages;
  if (typeof r.hasPrev === 'boolean') paginacion.hasPrev = r.hasPrev;
  return paginacion;
}

/** Trae TODAS las paginas de `GET /medications...` (paginacion page/limit) como items ya tipados. */
async function listarMedicamentosCompleto(sesion: Sesion, rutaBase: string): Promise<ItemMedicamento[]> {
  const items: ItemMedicamento[] = [];
  let pagina = 1;
  for (let vueltas = 0; vueltas < 50; vueltas += 1) {
    const separador = rutaBase.includes('?') ? '&' : '?';
    const r = await sesion.get(`${rutaBase}${separador}page=${pagina}&limit=100`);
    if (r.status !== 200) throw new Error(`GET ${rutaBase} pagina ${pagina} -> ${r.status}: ${JSON.stringify(r.body)}`);
    const cuerpo = comoRegistro(r.body);
    items.push(...comoArreglo(cuerpo.data).map(comoItemMedicamento));
    const paginacion = comoPaginacion(cuerpo.pagination);
    if (!paginacion.hasNext) return items;
    pagina += 1;
  }
  throw new Error('Demasiadas paginas: posible bucle infinito.');
}

let farmacia: Sesion;
let director: Sesion;
let consulta: Sesion;
let farmaciaId: string;
let referencia: Date;

async function idDeSesion(sesion: Sesion): Promise<string> {
  const r = await sesion.get(`${PREFIJO}/users/me`);
  if (r.status !== 200) throw new Error(`GET /users/me -> ${r.status}`);
  return comoTexto(comoRegistro(comoRegistro(r.body).data).id);
}

/** Limpia cualquier resto del codigo sintetico de una corrida anterior interrumpida. */
async function limpiarSintetico(): Promise<void> {
  await prisma.medicationStock.deleteMany({ where: { code: CODIGO_SINTETICO } });
  await prisma.medicationDispense.deleteMany({ where: { id: ID_DISPENSACION_SINTETICA } });
  await prisma.medication.deleteMany({ where: { code: CODIGO_SINTETICO } });
}

beforeAll(async () => {
  [farmacia, director, consulta] = await Promise.all([
    comoRol(BASE, 'FARMACIA'),
    comoRol(BASE, 'DIRECTOR'),
    comoRol(BASE, 'CONSULTA'),
  ]);
  farmaciaId = await idDeSesion(farmacia);

  const maximo = await prisma.admission.aggregate({ _max: { admittedAt: true } });
  if (!maximo._max.admittedAt) throw new Error('No hay admisiones HIS importadas.');
  referencia = maximo._max.admittedAt;

  await limpiarSintetico();

  const admisionCualquiera = await prisma.admission.findFirst({ select: { id: true }, orderBy: { id: 'asc' } });
  if (!admisionCualquiera) throw new Error('No hay ninguna admision HIS para enlazar la dispensacion sintetica.');

  await prisma.medication.create({
    data: { code: CODIGO_SINTETICO, name: 'MEDICAMENTO SINTETICO E2E T16', kind: 'medicamento' },
  });
  await prisma.medicationDispense.create({
    data: {
      id: ID_DISPENSACION_SINTETICA,
      admissionId: admisionCualquiera.id,
      code: CODIGO_SINTETICO,
      quantity: CANTIDAD_DISPENSADA,
      dispensedAt: new Date(referencia.getTime() - 24 * 60 * 60 * 1000),
      area: 'FARMACIA',
      specialty: 'MEDICINA GENERAL',
    },
  });
}, 60_000);

afterAll(async () => {
  await limpiarSintetico();
  await prisma.$disconnect();
});

describe('GET /medications (T16)', () => {
  it('401 sin sesion', async () => {
    const r = await new Sesion(BASE).get(`${PREFIJO}/medications`);
    expect(r.status).toBe(401);
  });

  it('403 para CONSULTA (no tiene medications:read)', async () => {
    const r = await consulta.get(`${PREFIJO}/medications`);
    expect(r.status).toBe(403);
  });

  it('paginacion: el total y el orden por nombre coinciden con la BD', async () => {
    const totalReal = await prisma.medication.count();
    const primerosDiezReales = await prisma.medication.findMany({
      select: { code: true },
      orderBy: { name: 'asc' },
      take: 10,
    });

    const pagina1 = await director.get(`${PREFIJO}/medications?page=1&limit=5`);
    expect(pagina1.status).toBe(200);
    const cuerpo1 = comoRegistro(pagina1.body);
    const paginacion1 = comoPaginacion(cuerpo1.pagination);
    expect(paginacion1).toMatchObject({ total: totalReal, page: 1, limit: 5, hasPrev: false });
    expect(paginacion1.totalPages).toBe(Math.ceil(totalReal / 5));
    const items1 = comoArreglo(cuerpo1.data).map(comoItemMedicamento);
    expect(items1).toHaveLength(5);

    const pagina2 = await director.get(`${PREFIJO}/medications?page=2&limit=5`);
    const cuerpo2 = comoRegistro(pagina2.body);
    expect(comoPaginacion(cuerpo2.pagination)).toMatchObject({ page: 2, hasPrev: true });
    const items2 = comoArreglo(cuerpo2.data).map(comoItemMedicamento);

    // El mismo orden (name asc) que produce la propia BD para los 10 primeros.
    expect([...items1, ...items2].map((i) => i.code)).toEqual(primerosDiezReales.map((m) => m.code));
  });

  it('kind=medicamento / kind=insumo cotejado con conteos independientes de la BD', async () => {
    const [totalMedicamento, totalInsumo] = await Promise.all([
      prisma.medication.count({ where: { kind: 'medicamento' } }),
      prisma.medication.count({ where: { kind: 'insumo' } }),
    ]);
    expect(totalMedicamento).toBeGreaterThan(0);
    expect(totalInsumo).toBeGreaterThan(0);

    const [resMedicamento, resInsumo] = await Promise.all([
      farmacia.get(`${PREFIJO}/medications?kind=medicamento&limit=1`),
      farmacia.get(`${PREFIJO}/medications?kind=insumo&limit=1`),
    ]);
    expect(comoPaginacion(comoRegistro(resMedicamento.body).pagination).total).toBe(totalMedicamento);
    expect(comoPaginacion(comoRegistro(resInsumo.body).pagination).total).toBe(totalInsumo);

    // El importador clasifica por prefijo: todo "DM..." es insumo (B0), el resto medicamento.
    const insumoDeMuestra = await prisma.medication.findFirst({ where: { kind: 'insumo' } });
    expect(insumoDeMuestra?.code.startsWith('DM')).toBe(true);
  });

  it('search por nombre, insensible a mayusculas, coincide con un filtro JS independiente', async () => {
    const muestra = await prisma.medication.findFirst({ where: { name: { not: '' } } });
    if (!muestra) throw new Error('Catalogo de medicamentos vacio.');
    const termino = muestra.name.slice(0, Math.min(6, muestra.name.length)).trim();
    if (termino.length < 2) return; // nombre demasiado corto para un termino de busqueda valido.

    const todos = await prisma.medication.findMany({ select: { code: true, name: true } });
    const esperados = new Set(
      todos.filter((m) => m.name.toLowerCase().includes(termino.toLowerCase())).map((m) => m.code),
    );

    const items = await listarMedicamentosCompleto(farmacia, `${PREFIJO}/medications?search=${encodeURIComponent(termino)}`);
    expect(new Set(items.map((i) => i.code))).toEqual(esperados);
  });

  it('search con "%" literal no actua como comodin SQL (ILIKE escapado)', async () => {
    const todos = await prisma.medication.findMany({ select: { code: true, name: true } });
    const conPorcentaje = todos.find((m) => m.name.includes('%'));
    if (!conPorcentaje) {
      throw new Error('No se encontro ningun medicamento con "%" en el nombre en los datos reales importados.');
    }
    const indice = conPorcentaje.name.indexOf('%');
    const termino = indice > 0 ? conPorcentaje.name.slice(indice - 1, indice + 1) : conPorcentaje.name.slice(indice, indice + 2);
    expect(termino).toContain('%');
    expect(termino.length).toBe(2);

    // Cotejo 1: lo que DEBE devolver (contiene el literal "X%").
    const esperadoLiteral = new Set(
      todos.filter((m) => m.name.toLowerCase().includes(termino.toLowerCase())).map((m) => m.code),
    );
    // Cotejo 2: lo que devolveria SI "%" no se escapara (colapsa a "contiene X", el caracter suelto).
    const caracterSuelto = termino.replace('%', '');
    const siNoEscaparaSePareceAEsto = new Set(
      todos.filter((m) => caracterSuelto === '' || m.name.toLowerCase().includes(caracterSuelto.toLowerCase())).map((m) => m.code),
    );

    const items = await listarMedicamentosCompleto(farmacia, `${PREFIJO}/medications?search=${encodeURIComponent(termino)}`);
    const codigosApi = new Set(items.map((i) => i.code));

    expect(codigosApi).toEqual(esperadoLiteral);
    // La prueba solo demuestra algo si el comodin sin escapar habria devuelto MAS: si el
    // caracter suelto es muy raro esto podria empatar, pero con datos reales (miles de
    // nombres con digitos) el conjunto sin escapar es estrictamente mayor.
    expect(siNoEscaparaSePareceAEsto.size).toBeGreaterThanOrEqual(esperadoLiteral.size);
  });

  it('cantidades y lineas del periodo, cotejadas con una agregacion propia sobre la BD', async () => {
    const desde = new Date('2026-08-01T00:00:00.000Z');
    const hasta = new Date('2026-08-08T00:00:00.000Z');

    const filaDeMuestra = await prisma.medicationDispense.findFirst({
      where: { dispensedAt: { gte: desde, lte: hasta } },
      select: { code: true },
    });
    if (!filaDeMuestra) throw new Error('No hay dispensaciones reales en la ventana de prueba.');
    const codigo = filaDeMuestra.code;
    const medicamento = await prisma.medication.findUniqueOrThrow({ where: { code: codigo } });

    const filas = await prisma.medicationDispense.findMany({
      where: { code: codigo, dispensedAt: { gte: desde, lte: hasta } },
      select: { quantity: true },
    });
    const cantidadEsperada = filas.reduce((acc, f) => acc + f.quantity, 0);
    const lineasEsperadas = filas.length;

    const ultimaGlobal = await prisma.medicationDispense.aggregate({
      where: { code: codigo },
      _max: { dispensedAt: true },
    });

    // Se aisla por `search` (nombre exacto): el listado no filtra por periodo,
    // solo agrega sobre el; sin esto habria que paginar el catalogo completo.
    const items = await listarMedicamentosCompleto(
      farmacia,
      `${PREFIJO}/medications?desde=${desde.toISOString()}&hasta=${hasta.toISOString()}&search=${encodeURIComponent(medicamento.name.slice(0, 40))}`,
    );
    const item = items.find((i) => i.code === codigo);
    expect(item).toBeDefined();
    expect(item?.quantity).toBe(cantidadEsperada);
    expect(item?.lines).toBe(lineasEsperadas);
    expect(item?.lastDispensedAt).toBe(ultimaGlobal._max.dispensedAt?.toISOString() ?? null);
  });

  it('sin stock: stock/avgDailyConsumption/daysOfInventory/risk = insufficient_data, y rotation siempre insufficient_data', async () => {
    // `MedicationStock` no tiene relacion declarada hacia `Medication` (B0: sin
    // FK), asi que el candidato se busca con dos consultas propias, no con un
    // filtro por relacion.
    const conStock = await prisma.medicationStock.findMany({ select: { code: true } });
    const sinStock = await prisma.medication.findFirst({
      where: { code: { notIn: conStock.map((s) => s.code) } },
      select: { code: true, name: true },
    });
    if (!sinStock) throw new Error('No hay ningun medicamento sin stock registrado (inesperado tras la limpieza del setup).');

    const items = await listarMedicamentosCompleto(
      farmacia,
      `${PREFIJO}/medications?search=${encodeURIComponent(sinStock.name.slice(0, 40))}`,
    );
    const item = items.find((i) => i.code === sinStock.code);
    expect(item).toBeDefined();
    expect(item?.stock).toBeNull();
    expect(item?.avgDailyConsumption).toBe('insufficient_data');
    expect(item?.daysOfInventory).toBe('insufficient_data');
    expect(item?.risk).toBe('insufficient_data');
    expect(item?.rotation).toBe('insufficient_data');
  });

  it('un campo desconocido en la query responde 422', async () => {
    const r = await farmacia.get(`${PREFIJO}/medications?campoDesconocido=x`);
    expect(r.status).toBe(422);
  });
});

describe('GET /medications/consumption (T16)', () => {
  it('401 sin sesion', async () => {
    const r = await new Sesion(BASE).get(`${PREFIJO}/medications/consumption`);
    expect(r.status).toBe(401);
  });

  it('serie diaria, top-10 global y desglose por area, cotejados con una agregacion en memoria', async () => {
    const desde = new Date('2026-08-01T00:00:00.000Z');
    const hasta = new Date('2026-08-08T00:00:00.000Z');

    const filas = await prisma.medicationDispense.findMany({
      where: { dispensedAt: { gte: desde, lte: hasta } },
      select: { code: true, quantity: true, area: true, dispensedAt: true },
    });
    expect(filas.length).toBeGreaterThan(0);

    // Serie diaria en hora de Colombia (UTC-5 fijo, sin horario de verano, B0):
    // se resta 5h y se toma la fecha UTC resultante como "dia local".
    const porDia = new Map<string, number>();
    for (const f of filas) {
      const local = new Date(f.dispensedAt.getTime() - 5 * 60 * 60 * 1000);
      const dia = local.toISOString().slice(0, 10);
      porDia.set(dia, (porDia.get(dia) ?? 0) + f.quantity);
    }
    const serieEsperada = [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b));

    const porCodigo = new Map<string, number>();
    for (const f of filas) porCodigo.set(f.code, (porCodigo.get(f.code) ?? 0) + f.quantity);
    const topEsperado = [...porCodigo.entries()]
      .sort(([codeA, qA], [codeB, qB]) => qB - qA || codeA.localeCompare(codeB))
      .slice(0, 10);
    const nombres = await prisma.medication.findMany({ where: { code: { in: topEsperado.map(([c]) => c) } } });
    const nombrePorCodigo = new Map(nombres.map((m) => [m.code, m.name]));

    const porArea = new Map<string, number>();
    for (const f of filas) porArea.set(f.area, (porArea.get(f.area) ?? 0) + f.quantity);
    const byAreaEsperado = [...porArea.entries()].sort(([aA, qA], [aB, qB]) => qB - qA || aA.localeCompare(aB));

    const r = await farmacia.get(`${PREFIJO}/medications/consumption?desde=${desde.toISOString()}&hasta=${hasta.toISOString()}`);
    expect(r.status).toBe(200);
    const data = comoRegistro(r.body).data;
    const cuerpo = comoRegistro(data);

    const serieApi = comoArreglo(cuerpo.series).map((s) => {
      const f = comoRegistro(s);
      return [comoTexto(f.date).slice(0, 10), comoNumero(f.quantity)] as [string, number];
    });
    expect(serieApi).toEqual(serieEsperada);

    const topApi = comoArreglo(cuerpo.top).map((t) => {
      const f = comoRegistro(t);
      return { code: comoTexto(f.code), name: comoTexto(f.name), quantity: comoNumero(f.quantity) };
    });
    expect(topApi).toEqual(
      topEsperado.map(([code, quantity]) => ({ code, name: nombrePorCodigo.get(code) ?? code, quantity })),
    );

    const byAreaApi = comoArreglo(cuerpo.byArea).map((a) => {
      const f = comoRegistro(a);
      return [comoTexto(f.area), comoNumero(f.quantity)] as [string, number];
    });
    expect(byAreaApi).toEqual(byAreaEsperado);
  });

  it('grain=week agrupa por semana ISO (date_trunc), cotejado con el mismo calculo en memoria', async () => {
    const desde = new Date('2026-06-01T00:00:00.000Z');
    const hasta = new Date('2026-07-31T23:59:59.999Z');

    const filas = await prisma.medicationDispense.findMany({
      where: { code: CODIGO_SINTETICO, dispensedAt: { gte: desde, lte: hasta } },
      select: { quantity: true, dispensedAt: true },
    });
    // La dispensacion sintetica cae 1 dia antes de la referencia real (fuera de
    // este rango historico a proposito): confirma que el filtro por `code` deja
    // la serie vacia si no hay nada suyo en el periodo pedido.
    expect(filas).toHaveLength(0);

    const r = await farmacia.get(
      `${PREFIJO}/medications/consumption?desde=${desde.toISOString()}&hasta=${hasta.toISOString()}&code=${CODIGO_SINTETICO}&grain=week`,
    );
    expect(r.status).toBe(200);
    const cuerpo = comoRegistro(comoRegistro(r.body).data);
    expect(cuerpo.grain).toBe('week');
    expect(cuerpo.code).toBe(CODIGO_SINTETICO);
    expect(comoArreglo(cuerpo.series)).toHaveLength(0);
  });

  it('filtra la serie y el area por code sin afectar el top-10 global', async () => {
    const desde = new Date(referencia.getTime() - 2 * 24 * 60 * 60 * 1000);
    const hasta = new Date(referencia.getTime());

    const r = await farmacia.get(
      `${PREFIJO}/medications/consumption?desde=${desde.toISOString()}&hasta=${hasta.toISOString()}&code=${CODIGO_SINTETICO}`,
    );
    expect(r.status).toBe(200);
    const cuerpo = comoRegistro(comoRegistro(r.body).data);
    const serie = comoArreglo(cuerpo.series).map((s) => comoRegistro(s));
    expect(serie).toHaveLength(1);
    const [unicoDia] = serie;
    if (!unicoDia) throw new Error('Serie vacia (no deberia pasar tras el toHaveLength(1)).');
    expect(comoNumero(unicoDia.quantity)).toBe(CANTIDAD_DISPENSADA);
    const byArea = comoArreglo(cuerpo.byArea).map((a) => comoRegistro(a));
    expect(byArea).toEqual([{ area: 'FARMACIA', quantity: CANTIDAD_DISPENSADA }]);

    // El top-10 SIN filtrar por code: nuestro sintetico (210 unidades en 2 dias)
    // no domina el consumo real de todo el hospital en esa ventana.
    const topReal = await prisma.medicationDispense.groupBy({
      by: ['code'],
      where: { dispensedAt: { gte: desde, lte: hasta } },
      _sum: { quantity: true },
    });
    const topRealOrdenado = [...topReal]
      .sort((a, b) => (b._sum.quantity ?? 0) - (a._sum.quantity ?? 0) || a.code.localeCompare(b.code))
      .slice(0, 10);
    const topApi = comoArreglo(cuerpo.top).map((t) => comoTexto(comoRegistro(t).code));
    expect(topApi).toEqual(topRealOrdenado.map((g) => g.code));
  });
});

describe('PUT /medications/:code/stock (T16)', () => {
  it('DIRECTOR no tiene medications:manage -> 403, sin efecto en la BD', async () => {
    const r = await director.put(`${PREFIJO}/medications/${CODIGO_SINTETICO}/stock`, { quantity: 10 });
    expect(r.status).toBe(403);
    const stock = await prisma.medicationStock.findUnique({ where: { code: CODIGO_SINTETICO } });
    expect(stock).toBeNull();
  });

  it('codigo invalido responde 422', async () => {
    const r = await farmacia.put(`${PREFIJO}/medications/ab/stock`, { quantity: 10 });
    expect(r.status).toBe(422);
  });

  it('cantidad negativa responde 422', async () => {
    const r = await farmacia.put(`${PREFIJO}/medications/${CODIGO_SINTETICO}/stock`, { quantity: -1 });
    expect(r.status).toBe(422);
  });

  it('OK bien por encima del umbral (dias=20): risk OK, cotejado, con auditoria from=null', async () => {
    const r = await farmacia.put(`${PREFIJO}/medications/${CODIGO_SINTETICO}/stock`, { quantity: 140 });
    expect(r.status).toBe(200);
    expect(comoRegistro(r.body).data).toMatchObject({ code: CODIGO_SINTETICO, quantity: 140 });

    const items = await listarMedicamentosCompleto(farmacia, `${PREFIJO}/medications?search=SINTETICO`);
    const item = items.find((i) => i.code === CODIGO_SINTETICO);
    expect(item).toMatchObject({
      stock: 140,
      avgDailyConsumption: CONSUMO_DIARIO_ESPERADO,
      daysOfInventory: 20,
      risk: 'OK',
      rotation: 'insufficient_data',
    });

    const rastro = await prisma.auditLog.findFirst({
      where: { action: 'medication.stock.updated', actorId: farmaciaId },
      orderBy: { createdAt: 'desc' },
    });
    expect(rastro).not.toBeNull();
    expect(rastro?.metadata).toMatchObject({ code: CODIGO_SINTETICO, from: null, to: 140 });
  });

  it('frontera EXACTA del umbral bajo (dias=7.0): risk OK, no LOW (comparacion estricta)', async () => {
    const r = await farmacia.put(`${PREFIJO}/medications/${CODIGO_SINTETICO}/stock`, { quantity: 49 });
    expect(r.status).toBe(200);
    const items = await listarMedicamentosCompleto(farmacia, `${PREFIJO}/medications?search=SINTETICO`);
    const item = items.find((i) => i.code === CODIGO_SINTETICO);
    expect(item?.daysOfInventory).toBe(7);
    expect(item?.risk).toBe('OK');

    const critico = await farmacia.get(`${PREFIJO}/medications/critical`);
    const cuerpo = comoRegistro(critico.body);
    const cuerpoData = comoRegistro(cuerpo.data);
    if (cuerpoData.status === 'ok') {
      const items2 = comoArreglo(cuerpoData.items).map((i) => comoRegistro(i));
      expect(items2.find((i) => i.code === CODIGO_SINTETICO)).toBeUndefined();
    }

    const rastro = await prisma.auditLog.findFirst({
      where: { action: 'medication.stock.updated', actorId: farmaciaId },
      orderBy: { createdAt: 'desc' },
    });
    expect(rastro?.metadata).toMatchObject({ code: CODIGO_SINTETICO, from: 140, to: 49 });
  });

  it('frontera EXACTA del umbral critico (dias=3.0): risk LOW, no CRITICAL; aparece en /critical', async () => {
    const r = await farmacia.put(`${PREFIJO}/medications/${CODIGO_SINTETICO}/stock`, { quantity: 21 });
    expect(r.status).toBe(200);
    const items = await listarMedicamentosCompleto(farmacia, `${PREFIJO}/medications?search=SINTETICO`);
    const item = items.find((i) => i.code === CODIGO_SINTETICO);
    expect(item?.daysOfInventory).toBe(3);
    expect(item?.risk).toBe('LOW');

    const critico = await farmacia.get(`${PREFIJO}/medications/critical`);
    const cuerpoData = comoRegistro(comoRegistro(critico.body).data);
    expect(cuerpoData.status).toBe('ok');
    const items2 = comoArreglo(cuerpoData.items).map((i) => comoRegistro(i));
    const elNuestro = items2.find((i) => i.code === CODIGO_SINTETICO);
    expect(elNuestro).toMatchObject({ risk: 'LOW', daysOfInventory: 3, stock: 21 });

    const rastro = await prisma.auditLog.findFirst({
      where: { action: 'medication.stock.updated', actorId: farmaciaId },
      orderBy: { createdAt: 'desc' },
    });
    expect(rastro?.metadata).toMatchObject({ code: CODIGO_SINTETICO, from: 49, to: 21 });
  });

  it('claramente CRITICAL (dias=2.0), y aparece en /critical con ese riesgo', async () => {
    const r = await farmacia.put(`${PREFIJO}/medications/${CODIGO_SINTETICO}/stock`, { quantity: 14 });
    expect(r.status).toBe(200);
    const items = await listarMedicamentosCompleto(farmacia, `${PREFIJO}/medications?search=SINTETICO`);
    const item = items.find((i) => i.code === CODIGO_SINTETICO);
    expect(item?.daysOfInventory).toBe(2);
    expect(item?.risk).toBe('CRITICAL');

    const critico = await farmacia.get(`${PREFIJO}/medications/critical`);
    const cuerpoData = comoRegistro(comoRegistro(critico.body).data);
    const items2 = comoArreglo(cuerpoData.items).map((i) => comoRegistro(i));
    expect(items2.find((i) => i.code === CODIGO_SINTETICO)).toMatchObject({
      risk: 'CRITICAL',
      daysOfInventory: 2,
      stock: 14,
      avgDailyConsumption: CONSUMO_DIARIO_ESPERADO,
    });

    // El orden es ascendente por dias de inventario: nuestro CRITICAL (2 dias)
    // no puede ir despues de un LOW/CRITICAL con mas dias que el suyo.
    const indiceNuestro = items2.findIndex((i) => i.code === CODIGO_SINTETICO);
    for (let i = 0; i < indiceNuestro; i += 1) {
      const anterior = items2[i];
      if (!anterior) throw new Error('Indice fuera de rango (no deberia pasar).');
      expect(comoNumero(anterior.daysOfInventory)).toBeLessThanOrEqual(2);
    }
  });
});
