import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AlertStatus } from '@prisma/client';
import { env } from '../../src/config/env';
import { UMBRALES_ALERTA_POR_DEFECTO } from '../../src/modules/alerts/alerts.constants';
import { comoRol, prismaE2E, Sesion } from './cliente';

/**
 * T16/TC5 (E2E, ola C-1): reglas del motor en BD (`AlertRule`) y alertas
 * manuales, sobre el proceso real y `hospital_e2e_d`.
 *
 * Usa un medicamento SINTETICO (`ZE2ERULEA`, con una unica dispensacion) para
 * controlar EXACTAMENTE los dias de inventario, igual que `alertas.e2e.test.ts`
 * hace con `ZE2EALERT1/2`: as no depende de cifras irregulares de codigos
 * reales y no toca ninguna metrica derivada de datos HIS reales (ocupacion,
 * espera, demanda, cirugia), asi que no interfiere con las aserciones de ese
 * archivo (que SI las usa) por mucho que ambos compartan servidor y BD
 * (`fileParallelism: false`: los archivos nunca corren a la vez).
 *
 * Al terminar (y tambien tras cada bloque que edita la regla LOW_STOCK) se
 * restaura `AlertRule` a sus valores por defecto: otra suite de esta misma
 * corrida (o la siguiente) asume que `env.ALERT_*` describe el umbral
 * EFECTIVO, y eso solo es cierto si nadie deja la regla editada.
 */

const BASE = inject('e2eUrl');
const PREFIJO = env.API_PREFIX;
const prisma = prismaE2E();

const CODIGO = 'ZE2ERULEA';
const ID_DISPENSACION = 900_300_001;
const CANTIDAD_DISPENSADA = 210; // avg = 210 / 30 dias = 7/dia exacto.
const CONSUMO_DIARIO = CANTIDAD_DISPENSADA / 30;
const STOCK_BAJO = 42; // dias = 42/7 = 6.0 -> WARNING con los umbrales por defecto (<3 CRITICAL, <7 WARNING).

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

function comoNumero(valor: unknown): number {
  if (typeof valor !== 'number') throw new Error(`Se esperaba un numero; se recibio: ${JSON.stringify(valor)}`);
  return valor;
}

interface ResultadoEvaluacion {
  creadas: number;
  actualizadas: number;
  resueltas: number;
}

function comoResultadoEvaluacion(valor: unknown): ResultadoEvaluacion {
  const r = comoRegistro(valor);
  return { creadas: comoNumero(r.creadas), actualizadas: comoNumero(r.actualizadas), resueltas: comoNumero(r.resueltas) };
}

async function restaurarReglaLowStock(): Promise<void> {
  const d = UMBRALES_ALERTA_POR_DEFECTO.LOW_STOCK;
  await prisma.alertRule.update({
    where: { type: 'LOW_STOCK' },
    data: { enabled: true, warningThreshold: d.warningThreshold, criticalThreshold: d.criticalThreshold },
  });
}

async function limpiarSinteticos(): Promise<void> {
  await prisma.alert.deleteMany({ where: { scopeId: CODIGO } });
  await prisma.medicationStock.deleteMany({ where: { code: CODIGO } });
  await prisma.medicationDispense.deleteMany({ where: { id: ID_DISPENSACION } });
  await prisma.medication.deleteMany({ where: { code: CODIGO } });
}

let admin: Sesion;
let farmacia: Sesion;
let director: Sesion;

beforeAll(async () => {
  [admin, farmacia, director] = await Promise.all([
    comoRol(BASE, 'ADMIN'),
    comoRol(BASE, 'FARMACIA'),
    comoRol(BASE, 'DIRECTOR'),
  ]);

  await limpiarSinteticos();
  await restaurarReglaLowStock();

  const maximo = await prisma.admission.aggregate({ _max: { admittedAt: true } });
  if (!maximo._max.admittedAt) throw new Error('No hay admisiones HIS importadas.');
  const referencia = maximo._max.admittedAt;
  const admisionCualquiera = await prisma.admission.findFirst({ select: { id: true }, orderBy: { id: 'asc' } });
  if (!admisionCualquiera) throw new Error('No hay ninguna admision HIS para enlazar la dispensacion sintetica.');

  const dispensadoEn = new Date(referencia.getTime() - 24 * 60 * 60 * 1000);
  await prisma.medication.create({ data: { code: CODIGO, name: 'MEDICAMENTO SINTETICO E2E REGLAS', kind: 'medicamento' } });
  await prisma.medicationDispense.create({
    data: {
      id: ID_DISPENSACION,
      admissionId: admisionCualquiera.id,
      code: CODIGO,
      quantity: CANTIDAD_DISPENSADA,
      dispensedAt: dispensadoEn,
      area: 'FARMACIA',
      specialty: 'MEDICINA GENERAL',
    },
  });
}, 60_000);

afterAll(async () => {
  await limpiarSinteticos();
  await restaurarReglaLowStock();
  await prisma.$disconnect();
});

describe('GET /alerts/rules[/:type]: permisos y forma', () => {
  it('401 sin sesion', async () => {
    const r = await new Sesion(BASE).get(`${PREFIJO}/alerts/rules`);
    expect(r.status).toBe(401);
  });

  it('DIRECTOR (alerts:read) ve las 5 reglas', async () => {
    const r = await director.get(`${PREFIJO}/alerts/rules`);
    expect(r.status).toBe(200);
    const filas = (comoRegistro(r.body).data as unknown[]).map(comoRegistro);
    expect(filas).toHaveLength(5);
  });

  it('un tipo desconocido en la ruta responde 422, no 404 (no cae en "/:id")', async () => {
    const r = await director.get(`${PREFIJO}/alerts/rules/NO_EXISTE`);
    expect(r.status).toBe(422);
  });
});

describe('PATCH /alerts/rules/:type: permisos y coherencia', () => {
  it('403 para DIRECTOR (alerts:read, sin system:manage)', async () => {
    const r = await director.patch(`${PREFIJO}/alerts/rules/LOW_STOCK`, { warningThreshold: 5 });
    expect(r.status).toBe(403);
  });

  it('403 para FARMACIA (alerts:manage, pero tampoco system:manage)', async () => {
    const r = await farmacia.patch(`${PREFIJO}/alerts/rules/LOW_STOCK`, { warningThreshold: 5 });
    expect(r.status).toBe(403);
  });

  it('LOW_STOCK con criticalThreshold >= warningThreshold responde 422', async () => {
    const r = await admin.patch(`${PREFIJO}/alerts/rules/LOW_STOCK`, { warningThreshold: 7, criticalThreshold: 7 });
    expect(r.status).toBe(422);
  });

  it('ADMIN puede cambiar solo enabled, sin tocar los umbrales', async () => {
    const r = await admin.patch(`${PREFIJO}/alerts/rules/LOW_STOCK`, { enabled: false });
    expect(r.status).toBe(200);
    expect(comoRegistro(r.body).data).toMatchObject({
      enabled: false,
      warningThreshold: UMBRALES_ALERTA_POR_DEFECTO.LOW_STOCK.warningThreshold,
    });
    await restaurarReglaLowStock();
  });
});

describe('Cambiar el umbral de LOW_STOCK por API cambia lo que genera /alerts/evaluate', () => {
  afterAll(restaurarReglaLowStock);

  it('con stock bajo se genera WARNING con el umbral por defecto; subir warningThreshold la resuelve', async () => {
    const put = await farmacia.put(`${PREFIJO}/medications/${CODIGO}/stock`, { quantity: STOCK_BAJO });
    expect(put.status).toBe(200);

    const primera = await farmacia.post(`${PREFIJO}/alerts/evaluate`);
    expect(primera.status).toBe(200);
    const dias = STOCK_BAJO / CONSUMO_DIARIO;
    const alerta = await prisma.alert.findFirstOrThrow({ where: { type: 'LOW_STOCK', scopeId: CODIGO } });
    expect(alerta.status).toBe(AlertStatus.OPEN);
    expect(alerta.severity).toBe('WARNING');
    expect(alerta.value).toBeCloseTo(dias, 6);
    expect(alerta.threshold).toBe(env.ALERT_LOW_STOCK_DAYS);

    // dias = 6.0: con warningThreshold=5 deja de ser candidata (6 no es < 5).
    const patch = await admin.patch(`${PREFIJO}/alerts/rules/LOW_STOCK`, { warningThreshold: 5 });
    expect(patch.status).toBe(200);

    const segunda = await farmacia.post(`${PREFIJO}/alerts/evaluate`);
    expect(segunda.status).toBe(200);
    const resuelta = await prisma.alert.findUniqueOrThrow({ where: { id: alerta.id } });
    expect(resuelta.status).toBe(AlertStatus.RESOLVED);

    // Restaurar el umbral por defecto la vuelve a generar (creada de nuevo).
    await admin.patch(`${PREFIJO}/alerts/rules/LOW_STOCK`, { warningThreshold: env.ALERT_LOW_STOCK_DAYS });
    const tercera = await farmacia.post(`${PREFIJO}/alerts/evaluate`);
    const resultado3 = comoResultadoEvaluacion(comoRegistro(tercera.body).data);
    expect(resultado3.creadas).toBeGreaterThanOrEqual(1);
    const reabierta = await prisma.alert.findFirstOrThrow({
      where: { type: 'LOW_STOCK', scopeId: CODIGO, status: AlertStatus.OPEN },
    });
    expect(reabierta.id).not.toBe(alerta.id);
  });
});

describe('Desactivar LOW_STOCK resuelve la abierta y deja de generarla; reactivarla la recrea', () => {
  afterAll(restaurarReglaLowStock);

  it('ciclo desactivar -> evaluar -> reactivar -> evaluar', async () => {
    await farmacia.put(`${PREFIJO}/medications/${CODIGO}/stock`, { quantity: STOCK_BAJO });
    await farmacia.post(`${PREFIJO}/alerts/evaluate`);
    const abierta = await prisma.alert.findFirstOrThrow({
      where: { type: 'LOW_STOCK', scopeId: CODIGO, status: AlertStatus.OPEN },
    });

    const desactivar = await admin.patch(`${PREFIJO}/alerts/rules/LOW_STOCK`, { enabled: false });
    expect(desactivar.status).toBe(200);

    const trasDesactivar = await farmacia.post(`${PREFIJO}/alerts/evaluate`);
    expect(trasDesactivar.status).toBe(200);
    const resuelta = await prisma.alert.findUniqueOrThrow({ where: { id: abierta.id } });
    expect(resuelta.status).toBe(AlertStatus.RESOLVED);

    // Sigue desactivada: no se recrea en una segunda pasada.
    await farmacia.post(`${PREFIJO}/alerts/evaluate`);
    const siguenCerradas = await prisma.alert.count({
      where: { type: 'LOW_STOCK', scopeId: CODIGO, status: { in: [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED] } },
    });
    expect(siguenCerradas).toBe(0);

    const reactivar = await admin.patch(`${PREFIJO}/alerts/rules/LOW_STOCK`, { enabled: true });
    expect(reactivar.status).toBe(200);

    await farmacia.post(`${PREFIJO}/alerts/evaluate`);
    const reabierta = await prisma.alert.count({
      where: { type: 'LOW_STOCK', scopeId: CODIGO, status: AlertStatus.OPEN },
    });
    expect(reabierta).toBeGreaterThanOrEqual(1);
  });
});

describe('Alerta manual: el motor nunca la resuelve ni la pisa; borrado', () => {
  it('FARMACIA no puede crear una manual de scope "service" (fuera de su ambito): 403', async () => {
    const r = await farmacia.post(`${PREFIJO}/alerts`, {
      type: 'HIGH_OCCUPANCY',
      severity: 'WARNING',
      scope: 'service',
      message: 'Fuera de ambito.',
    });
    expect(r.status).toBe(403);
  });

  it('FARMACIA crea una manual con la MISMA clave (type, scopeId) que el candidato real del motor', async () => {
    await farmacia.put(`${PREFIJO}/medications/${CODIGO}/stock`, { quantity: STOCK_BAJO });

    const creada = await farmacia.post(`${PREFIJO}/alerts`, {
      type: 'LOW_STOCK',
      severity: 'CRITICAL',
      scope: 'medication',
      scopeId: CODIGO,
      message: 'Nota manual E2E: el proveedor confirma retraso.',
    });
    expect(creada.status).toBe(201);
    const manual = comoRegistro(creada.body).data;
    expect(manual).toMatchObject({ source: 'manual', value: 0, threshold: 0, status: 'OPEN' });
    const idManual = comoTexto(comoRegistro(manual).id);

    // El motor detecta el mismo (type, scopeId): debe crear una fila APARTE
    // (source "engine"), sin tocar la manual.
    const evaluar = await farmacia.post(`${PREFIJO}/alerts/evaluate`);
    expect(evaluar.status).toBe(200);

    const filas = await prisma.alert.findMany({ where: { type: 'LOW_STOCK', scopeId: CODIGO } });
    expect(filas.length).toBeGreaterThanOrEqual(2);
    const filaManual = filas.find((f) => f.id === idManual);
    const filaMotor = filas.find((f) => f.source === 'engine' && f.status === AlertStatus.OPEN);
    expect(filaManual?.status).toBe(AlertStatus.OPEN);
    expect(filaManual?.message).toBe('Nota manual E2E: el proveedor confirma retraso.');
    expect(filaMotor).toBeDefined();

    // Borrar la manual: 204, y no afecta a la del motor.
    const borrar = await farmacia.delete(`${PREFIJO}/alerts/${idManual}`);
    expect(borrar.status).toBe(204);
    const trasBorrar = await farmacia.get(`${PREFIJO}/alerts/${idManual}`);
    expect(trasBorrar.status).toBe(404);

    if (filaMotor) {
      const motorSigue = await prisma.alert.findUniqueOrThrow({ where: { id: filaMotor.id } });
      expect(motorSigue.status).toBe(AlertStatus.OPEN);

      // La del motor, abierta, no se puede borrar directamente.
      const borrarMotorAbierta = await farmacia.delete(`${PREFIJO}/alerts/${filaMotor.id}`);
      expect(borrarMotorAbierta.status).toBe(409);

      // Reconocer y resolver, y ENTONCES si se puede borrar.
      await farmacia.patch(`${PREFIJO}/alerts/${filaMotor.id}`, { status: 'ACKNOWLEDGED' });
      await farmacia.patch(`${PREFIJO}/alerts/${filaMotor.id}`, { status: 'RESOLVED' });
      const borrarResuelta = await farmacia.delete(`${PREFIJO}/alerts/${filaMotor.id}`);
      expect(borrarResuelta.status).toBe(204);
    }
  });
});
