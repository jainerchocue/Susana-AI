import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { env } from '../../src/config/env';
import { comoRol, prismaE2E, Sesion } from './cliente';

/**
 * TC4 (ola E2): CRUD completo de medicamentos sobre el proceso real y los
 * datos HIS reales importados (E0) -- catalogo, stock (listado + borrado) y
 * dispensaciones -- complementario a `medicamentos.e2e.test.ts` (T16, que
 * cubre el catalogo/stock de solo lectura y el PUT de stock existentes desde
 * T9). Nada de supertest ni de servicios de `src/`: cada cifra se coteja con
 * una consulta propia contra `prismaE2E()`.
 *
 * Codigos/ids sinteticos EXCLUSIVOS de este archivo (distintos de los que ya
 * usa `medicamentos.e2e.test.ts`: 'ZE2ESTOCK1' e id 900_100_001), todos con
 * prefijo `ZE2E` e ids >= 9.000.000 (C0). Cada test limpia lo que crea; el
 * `beforeAll`/`afterAll` son ademas una red de seguridad por si una corrida
 * anterior se interrumpio a medias.
 */

const BASE = inject('e2eUrl');
const PREFIJO = env.API_PREFIX;
const prisma = prismaE2E();

const CODIGO_CATALOGO = 'ZE2ECRUD01';
const CODIGO_STOCK = 'ZE2ECRUD02';
const CODIGO_DISPENSA = 'ZE2ECRUD03';
const CODIGO_DETALLE = 'ZE2ECRUD04';
const TODOS_LOS_CODIGOS = [CODIGO_CATALOGO, CODIGO_STOCK, CODIGO_DISPENSA, CODIGO_DETALLE];

const ID_DISPENSA_BLOQUEO = 9_100_001;
const ID_DISPENSA_CICLO = 9_100_002;
const ID_DISPENSA_DETALLE = 9_100_003;
const TODOS_LOS_IDS = [ID_DISPENSA_BLOQUEO, ID_DISPENSA_CICLO, ID_DISPENSA_DETALLE];

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

function comoNumero(valor: unknown): number {
  if (typeof valor !== 'number') throw new Error(`Se esperaba un numero; se recibio: ${JSON.stringify(valor)}`);
  return valor;
}

let admin: Sesion;
let farmacia: Sesion;
let director: Sesion;
let consulta: Sesion;
let admisionRealId: number;
let referencia: Date;

/** Limpia cualquier resto de una corrida anterior interrumpida (mismo patron que el archivo hermano). */
async function limpiarSintetico(): Promise<void> {
  await prisma.medicationDispense.deleteMany({ where: { id: { in: TODOS_LOS_IDS } } });
  await prisma.medicationDispense.deleteMany({ where: { code: { in: TODOS_LOS_CODIGOS } } });
  await prisma.medicationStock.deleteMany({ where: { code: { in: TODOS_LOS_CODIGOS } } });
  await prisma.medication.deleteMany({ where: { code: { in: TODOS_LOS_CODIGOS } } });
}

beforeAll(async () => {
  [admin, farmacia, director, consulta] = await Promise.all([
    comoRol(BASE, 'ADMIN'),
    comoRol(BASE, 'FARMACIA'),
    comoRol(BASE, 'DIRECTOR'),
    comoRol(BASE, 'CONSULTA'),
  ]);

  const maximo = await prisma.admission.aggregate({ _max: { admittedAt: true } });
  if (!maximo._max.admittedAt) throw new Error('No hay admisiones HIS importadas.');
  referencia = maximo._max.admittedAt;

  const cualquiera = await prisma.admission.findFirst({ select: { id: true }, orderBy: { id: 'asc' } });
  if (!cualquiera) throw new Error('No hay ninguna admision HIS para enlazar las dispensaciones sinteticas.');
  admisionRealId = cualquiera.id;

  await limpiarSintetico();
}, 60_000);

afterAll(async () => {
  await limpiarSintetico();
  await prisma.$disconnect();
});

describe('Catalogo: POST/PATCH/DELETE /medications (TC4 CRUD)', () => {
  it('401 sin sesion; 403 para DIRECTOR (no tiene medications:manage)', async () => {
    const sinSesion = await new Sesion(BASE).post(`${PREFIJO}/medications`, {
      code: CODIGO_CATALOGO,
      name: 'x',
      kind: 'medicamento',
    });
    expect(sinSesion.status).toBe(401);

    const sinPermiso = await director.post(`${PREFIJO}/medications`, {
      code: CODIGO_CATALOGO,
      name: 'x',
      kind: 'medicamento',
    });
    expect(sinPermiso.status).toBe(403);
  });

  it('FARMACIA crea el medicamento (medications:manage), normalizado a mayusculas; el detalle sin stock da insufficient_data', async () => {
    const creado = await farmacia.post(`${PREFIJO}/medications`, {
      code: CODIGO_CATALOGO.toLowerCase(),
      name: '  Medicamento CRUD E2E  ',
      kind: 'medicamento',
    });
    expect(creado.status).toBe(201);
    expect(comoRegistro(creado.body).data).toMatchObject({
      code: CODIGO_CATALOGO,
      name: 'Medicamento CRUD E2E',
      kind: 'medicamento',
    });

    const enBd = await prisma.medication.findUnique({ where: { code: CODIGO_CATALOGO } });
    expect(enBd).toMatchObject({ name: 'Medicamento CRUD E2E', kind: 'medicamento' });

    const detalle = await director.get(`${PREFIJO}/medications/${CODIGO_CATALOGO}`);
    expect(detalle.status).toBe(200);
    expect(comoRegistro(detalle.body).data).toMatchObject({
      code: CODIGO_CATALOGO,
      stock: null,
      avgDailyConsumption: 'insufficient_data',
      daysOfInventory: 'insufficient_data',
      risk: 'insufficient_data',
    });
  });

  it('409 al repetir el mismo codigo', async () => {
    const res = await admin.post(`${PREFIJO}/medications`, { code: CODIGO_CATALOGO, name: 'otro', kind: 'insumo' });
    expect(res.status).toBe(409);
  });

  it('PATCH: 403 para DIRECTOR; FARMACIA edita y se refleja en la BD', async () => {
    const sinPermiso = await director.patch(`${PREFIJO}/medications/${CODIGO_CATALOGO}`, { name: 'x' });
    expect(sinPermiso.status).toBe(403);

    const editado = await farmacia.patch(`${PREFIJO}/medications/${CODIGO_CATALOGO}`, {
      name: 'Medicamento CRUD E2E editado',
    });
    expect(editado.status).toBe(200);
    const enBd = await prisma.medication.findUniqueOrThrow({ where: { code: CODIGO_CATALOGO } });
    expect(enBd.name).toBe('Medicamento CRUD E2E editado');
  });

  it('409 con dispensaciones Y stock; se libera borrando cada dependiente; 204 al final', async () => {
    await prisma.medicationDispense.create({
      data: {
        id: ID_DISPENSA_BLOQUEO,
        admissionId: admisionRealId,
        code: CODIGO_CATALOGO,
        quantity: 1,
        dispensedAt: new Date(referencia.getTime() - 24 * 60 * 60 * 1000),
        area: 'FARMACIA',
        specialty: 'MEDICINA GENERAL',
      },
    });
    const conStock = await farmacia.put(`${PREFIJO}/medications/${CODIGO_CATALOGO}/stock`, { quantity: 5 });
    expect(conStock.status).toBe(200);

    const primerIntento = await admin.delete(`${PREFIJO}/medications/${CODIGO_CATALOGO}`);
    expect(primerIntento.status).toBe(409);
    expect(comoRegistro(comoRegistro(primerIntento.body).error).message).toMatch(/dispensacion/);

    const borrarStock = await admin.delete(`${PREFIJO}/medications/${CODIGO_CATALOGO}/stock`);
    expect(borrarStock.status).toBe(204);

    const segundoIntento = await admin.delete(`${PREFIJO}/medications/${CODIGO_CATALOGO}`);
    expect(segundoIntento.status).toBe(409);

    await prisma.medicationDispense.delete({ where: { id: ID_DISPENSA_BLOQUEO } });

    const tercerIntento = await admin.delete(`${PREFIJO}/medications/${CODIGO_CATALOGO}`);
    expect(tercerIntento.status).toBe(204);

    const yaNoExiste = await prisma.medication.findUnique({ where: { code: CODIGO_CATALOGO } });
    expect(yaNoExiste).toBeNull();
  });
});

describe('Stock: GET /medications/stock y DELETE /:code/stock (TC4 CRUD)', () => {
  it('401 sin sesion; 403 para CONSULTA', async () => {
    const sinSesion = await new Sesion(BASE).get(`${PREFIJO}/medications/stock`);
    expect(sinSesion.status).toBe(401);

    const sinPermiso = await consulta.get(`${PREFIJO}/medications/stock`);
    expect(sinPermiso.status).toBe(403);
  });

  it('FARMACIA registra stock; aparece en el listado cotejado con la BD; DIRECTOR no puede borrarlo, FARMACIA si', async () => {
    const alta = await admin.post(`${PREFIJO}/medications`, { code: CODIGO_STOCK, name: 'Stock CRUD E2E', kind: 'insumo' });
    expect(alta.status).toBe(201);

    const put = await farmacia.put(`${PREFIJO}/medications/${CODIGO_STOCK}/stock`, { quantity: 42 });
    expect(put.status).toBe(200);

    const totalReal = await prisma.medicationStock.count();
    const listado = await director.get(`${PREFIJO}/medications/stock?limit=100`);
    expect(listado.status).toBe(200);
    const cuerpo = comoRegistro(listado.body);
    expect(comoNumero(comoRegistro(cuerpo.pagination).total)).toBe(totalReal);
    const items = comoArreglo(cuerpo.data).map(comoRegistro);
    expect(items.find((i) => i.code === CODIGO_STOCK)).toMatchObject({ code: CODIGO_STOCK, quantity: 42 });

    const sinPermiso = await director.delete(`${PREFIJO}/medications/${CODIGO_STOCK}/stock`);
    expect(sinPermiso.status).toBe(403);

    const borrado = await farmacia.delete(`${PREFIJO}/medications/${CODIGO_STOCK}/stock`);
    expect(borrado.status).toBe(204);

    const enBd = await prisma.medicationStock.findUnique({ where: { code: CODIGO_STOCK } });
    expect(enBd).toBeNull();

    const limpieza = await admin.delete(`${PREFIJO}/medications/${CODIGO_STOCK}`);
    expect(limpieza.status).toBe(204);
  });
});

describe('Dispensaciones: CRUD completo /medications/dispenses (TC4 CRUD)', () => {
  it('401 sin sesion en el listado; 403 para CONSULTA (lectura); 403 para FARMACIA en POST (sin data:manage)', async () => {
    const sinSesion = await new Sesion(BASE).get(`${PREFIJO}/medications/dispenses`);
    expect(sinSesion.status).toBe(401);

    const sinLectura = await consulta.get(`${PREFIJO}/medications/dispenses`);
    expect(sinLectura.status).toBe(403);

    const sinEscritura = await farmacia.post(`${PREFIJO}/medications/dispenses`, {
      id: ID_DISPENSA_CICLO,
      admissionId: admisionRealId,
      code: 'ZE2ENOEXISTE',
      quantity: 1,
      dispensedAt: '2026-01-01T08:00:00-05:00',
      area: 'FARMACIA',
      specialty: 'MEDICINA GENERAL',
    });
    expect(sinEscritura.status).toBe(403);
  });

  it('ADMIN crea una dispensacion sintetica y RECALCULA lastActivityAt del ingreso enlazado', async () => {
    const alta = await admin.post(`${PREFIJO}/medications`, {
      code: CODIGO_DISPENSA,
      name: 'Dispensa CRUD E2E',
      kind: 'medicamento',
    });
    expect(alta.status).toBe(201);

    // Fecha muy en el futuro respecto a CUALQUIER dato real del HIS (los datos
    // acaban en 2026-09-21, B0): garantiza ser el maximo de actividad del
    // ingreso sin tener que conocer el resto de su historial real.
    const futura = '2031-01-01T08:00:00-05:00';
    const creado = await admin.post(`${PREFIJO}/medications/dispenses`, {
      id: ID_DISPENSA_CICLO,
      admissionId: admisionRealId,
      code: CODIGO_DISPENSA,
      quantity: 3,
      dispensedAt: futura,
      area: 'FARMACIA',
      specialty: 'MEDICINA GENERAL',
    });
    expect(creado.status).toBe(201);
    expect(comoRegistro(creado.body).data).toMatchObject({
      id: ID_DISPENSA_CICLO,
      admissionId: admisionRealId,
      code: CODIGO_DISPENSA,
      quantity: 3,
    });

    const ingreso = await prisma.admission.findUniqueOrThrow({ where: { id: admisionRealId } });
    expect(ingreso.lastActivityAt?.toISOString()).toBe(new Date(futura).toISOString());
  });

  it('GET /dispenses/:id devuelve la creada; 404 para un id inexistente', async () => {
    const detalle = await farmacia.get(`${PREFIJO}/medications/dispenses/${ID_DISPENSA_CICLO}`);
    expect(detalle.status).toBe(200);
    expect(comoRegistro(detalle.body).data).toMatchObject({ id: ID_DISPENSA_CICLO, code: CODIGO_DISPENSA });

    const inexistente = await farmacia.get(`${PREFIJO}/medications/dispenses/999999999`);
    expect(inexistente.status).toBe(404);
  });

  it('PATCH: 403 para FARMACIA (sin data:manage); ADMIN edita cantidad y area', async () => {
    const sinPermiso = await farmacia.patch(`${PREFIJO}/medications/dispenses/${ID_DISPENSA_CICLO}`, { quantity: 9 });
    expect(sinPermiso.status).toBe(403);

    const editado = await admin.patch(`${PREFIJO}/medications/dispenses/${ID_DISPENSA_CICLO}`, {
      quantity: 9,
      area: 'URGENCIAS',
    });
    expect(editado.status).toBe(200);
    expect(comoRegistro(editado.body).data).toMatchObject({ quantity: 9, area: 'URGENCIAS' });
  });

  it('lista y filtra por code, cotejado con una consulta propia a la BD', async () => {
    const esperadas = await prisma.medicationDispense.findMany({ where: { code: CODIGO_DISPENSA } });
    const res = await director.get(`${PREFIJO}/medications/dispenses?code=${CODIGO_DISPENSA}`);
    expect(res.status).toBe(200);
    expect(comoArreglo(comoRegistro(res.body).data)).toHaveLength(esperadas.length);
  });

  it('DELETE: 403 para FARMACIA (sin data:manage); ADMIN borra y desaparece; 404 despues', async () => {
    const sinPermiso = await farmacia.delete(`${PREFIJO}/medications/dispenses/${ID_DISPENSA_CICLO}`);
    expect(sinPermiso.status).toBe(403);

    const borrado = await admin.delete(`${PREFIJO}/medications/dispenses/${ID_DISPENSA_CICLO}`);
    expect(borrado.status).toBe(204);

    const yaNoExiste = await director.get(`${PREFIJO}/medications/dispenses/${ID_DISPENSA_CICLO}`);
    expect(yaNoExiste.status).toBe(404);

    const limpieza = await admin.delete(`${PREFIJO}/medications/${CODIGO_DISPENSA}`);
    expect(limpieza.status).toBe(204);
  });
});

describe('Detalle: GET /medications/:code con stock, cotejado a mano (TC4 CRUD)', () => {
  it('consumo de 30 dias, dias de inventario y riesgo calculados a mano (avg=2/dia, dias=3, LOW)', async () => {
    const alta = await admin.post(`${PREFIJO}/medications`, {
      code: CODIGO_DETALLE,
      name: 'Detalle CRUD E2E',
      kind: 'medicamento',
    });
    expect(alta.status).toBe(201);

    const dispensadaEn = new Date(referencia.getTime() - 10 * 24 * 60 * 60 * 1000);
    await prisma.medicationDispense.create({
      data: {
        id: ID_DISPENSA_DETALLE,
        admissionId: admisionRealId,
        code: CODIGO_DETALLE,
        quantity: 60,
        dispensedAt: dispensadaEn,
        area: 'FARMACIA',
        specialty: 'MEDICINA GENERAL',
      },
    });
    const put = await farmacia.put(`${PREFIJO}/medications/${CODIGO_DETALLE}/stock`, { quantity: 6 });
    expect(put.status).toBe(200);

    const detalle = await director.get(`${PREFIJO}/medications/${CODIGO_DETALLE}`);
    expect(detalle.status).toBe(200);
    const data = comoRegistro(comoRegistro(detalle.body).data);
    expect(data).toMatchObject({ code: CODIGO_DETALLE, stock: 6, consumption30d: 60, daysOfInventory: 3, risk: 'LOW' });
    expect(comoNumero(data.avgDailyConsumption)).toBeCloseTo(2, 3);

    await admin.delete(`${PREFIJO}/medications/${CODIGO_DETALLE}/stock`);
    await prisma.medicationDispense.delete({ where: { id: ID_DISPENSA_DETALLE } });
    const limpieza = await admin.delete(`${PREFIJO}/medications/${CODIGO_DETALLE}`);
    expect(limpieza.status).toBe(204);
  });
});
