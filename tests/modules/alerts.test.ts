import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AlertSeverity, AlertStatus } from '@prisma/client';
import { evaluarReglas, UMBRALES, type AlertCandidate, type MetricPoint } from '../../src/modules/alerts/alerts.engine';
import * as alertsService from '../../src/modules/alerts/alerts.service';
import { api, crearUsuarioConRol, getApp, limpiar, prisma } from '../helpers';

/** Atajo para construir un punto de metrica en las pruebas del motor. */
function punto(metric: MetricPoint['metric'], scope: MetricPoint['scope'], value: MetricPoint['value']): MetricPoint {
  return { metric, scope, scopeId: 'X', label: 'Etiqueta de prueba', value };
}

function candidatoLowStock(scopeId: string, value = 2): AlertCandidate {
  return {
    type: 'LOW_STOCK',
    severity: AlertSeverity.CRITICAL,
    scope: 'medication',
    scopeId,
    metric: 'medication.daysOfInventory',
    value,
    threshold: UMBRALES.criticalStockDays,
    message: `Medicamento ${scopeId}: ${value.toFixed(1)} por debajo del umbral de ${UMBRALES.criticalStockDays}.`,
  };
}

async function limpiarAlertas(): Promise<void> {
  await prisma.alert.deleteMany();
}

async function sembrarAlertaMedicamento(status: AlertStatus = AlertStatus.OPEN) {
  return prisma.alert.create({
    data: {
      type: 'LOW_STOCK',
      severity: AlertSeverity.CRITICAL,
      status,
      scope: 'medication',
      scopeId: 'MED-X',
      metric: 'medication.daysOfInventory',
      value: 1,
      threshold: 3,
      message: 'Paracetamol: 1.0 por debajo del umbral de 3.',
    },
  });
}

async function sembrarAlertaServicio() {
  return prisma.alert.create({
    data: {
      type: 'HIGH_OCCUPANCY',
      severity: AlertSeverity.WARNING,
      status: AlertStatus.OPEN,
      scope: 'service',
      scopeId: 'URG',
      metric: 'service.occupancyPct',
      value: 90,
      threshold: 85,
      message: 'Urgencias: 90.0 por encima del umbral de 85.',
    },
  });
}

describe('Modulo de alertas (T3)', () => {
  beforeAll(async () => {
    await getApp();
    await limpiar();
    await limpiarAlertas();
  });

  afterAll(async () => {
    await limpiar();
    await limpiarAlertas();
    await prisma.$disconnect();
  });

  describe('Motor de reglas: evaluarReglas', () => {
    it('LOW_STOCK: en el umbral exacto no hay alerta (comparacion estricta)', () => {
      const puntos = [punto('medication.daysOfInventory', 'medication', UMBRALES.lowStockDays)];
      expect(evaluarReglas(puntos)).toHaveLength(0);
    });

    it('LOW_STOCK: WARNING justo por debajo del umbral', () => {
      const puntos = [punto('medication.daysOfInventory', 'medication', UMBRALES.lowStockDays - 0.1)];
      expect(evaluarReglas(puntos)[0]?.severity).toBe(AlertSeverity.WARNING);
    });

    it('LOW_STOCK: CRITICAL por debajo del umbral critico', () => {
      const puntos = [punto('medication.daysOfInventory', 'medication', UMBRALES.criticalStockDays - 0.1)];
      const [candidato] = evaluarReglas(puntos);
      expect(candidato?.severity).toBe(AlertSeverity.CRITICAL);
      expect(candidato?.type).toBe('LOW_STOCK');
    });

    it('HIGH_OCCUPANCY: en el umbral exacto no hay alerta', () => {
      const puntos = [punto('service.occupancyPct', 'service', UMBRALES.occupancyPct)];
      expect(evaluarReglas(puntos)).toHaveLength(0);
    });

    it('HIGH_OCCUPANCY: WARNING justo por encima del umbral, CRITICAL sobre el umbral critico', () => {
      const warning = evaluarReglas([punto('service.occupancyPct', 'service', UMBRALES.occupancyPct + 0.1)]);
      expect(warning[0]?.severity).toBe(AlertSeverity.WARNING);

      const critical = evaluarReglas([punto('service.occupancyPct', 'service', UMBRALES.criticalOccupancyPct + 0.1)]);
      expect(critical[0]?.severity).toBe(AlertSeverity.CRITICAL);
    });

    it('LONG_WAIT: CRITICAL exactamente al doble del umbral no alerta; por encima si', () => {
      const doble = UMBRALES.waitMinutes * 2;
      const enElDoble = evaluarReglas([punto('triage.waitMinutesP50', 'triage', doble)]);
      expect(enElDoble[0]?.severity).toBe(AlertSeverity.WARNING);

      const sobreElDoble = evaluarReglas([punto('triage.waitMinutesP50', 'triage', doble + 0.1)]);
      expect(sobreElDoble[0]?.severity).toBe(AlertSeverity.CRITICAL);
    });

    it('DEMAND_SPIKE solo tiene nivel WARNING', () => {
      const [candidato] = evaluarReglas([
        punto('service.demandChangePct', 'service', UMBRALES.demandSpikePct + 50),
      ]);
      expect(candidato?.severity).toBe(AlertSeverity.WARNING);
      expect(candidato?.type).toBe('DEMAND_SPIKE');
    });

    it('SURGERY_CANCELLATIONS solo tiene nivel WARNING', () => {
      const [candidato] = evaluarReglas([
        punto('surgery.cancellationPct', 'surgery', UMBRALES.surgeryCancellationPct + 50),
      ]);
      expect(candidato?.severity).toBe(AlertSeverity.WARNING);
      expect(candidato?.type).toBe('SURGERY_CANCELLATIONS');
    });

    it('insufficient_data nunca genera alerta', () => {
      const puntos = [punto('medication.daysOfInventory', 'medication', 'insufficient_data')];
      expect(evaluarReglas(puntos)).toHaveLength(0);
    });
  });

  describe('alerts.service · sincronizar', () => {
    beforeEach(limpiarAlertas);

    it('crea una alerta OPEN cuando no existe una con la misma clave', async () => {
      const resultado = await alertsService.sincronizar(
        [candidatoLowStock('MED-A')],
        ['medication.daysOfInventory'],
      );
      expect(resultado).toEqual({ creadas: 1, actualizadas: 0, resueltas: 0 });

      const fila = await prisma.alert.findFirstOrThrow({ where: { type: 'LOW_STOCK', scopeId: 'MED-A' } });
      expect(fila.status).toBe(AlertStatus.OPEN);
    });

    it('actualiza sin duplicar cuando ya existe una abierta con la misma clave', async () => {
      await alertsService.sincronizar([candidatoLowStock('MED-B', 2)], ['medication.daysOfInventory']);
      const resultado = await alertsService.sincronizar(
        [candidatoLowStock('MED-B', 1)],
        ['medication.daysOfInventory'],
      );

      expect(resultado).toEqual({ creadas: 0, actualizadas: 1, resueltas: 0 });
      const filas = await prisma.alert.findMany({ where: { type: 'LOW_STOCK', scopeId: 'MED-B' } });
      expect(filas).toHaveLength(1);
      expect(filas[0]?.value).toBe(1);
    });

    it('resuelve una alerta abierta cuya clave ya no aparece entre los candidatos evaluados', async () => {
      await alertsService.sincronizar([candidatoLowStock('MED-C')], ['medication.daysOfInventory']);
      const resultado = await alertsService.sincronizar([], ['medication.daysOfInventory']);

      expect(resultado).toEqual({ creadas: 0, actualizadas: 0, resueltas: 1 });
      const fila = await prisma.alert.findFirstOrThrow({ where: { type: 'LOW_STOCK', scopeId: 'MED-C' } });
      expect(fila.status).toBe(AlertStatus.RESOLVED);
      expect(fila.resolvedAt).not.toBeNull();
    });

    it('una alerta cuya metrica no esta entre las evaluadas no se resuelve', async () => {
      await alertsService.sincronizar([candidatoLowStock('MED-D')], ['medication.daysOfInventory']);
      // Esta pasada evalua otra metrica: LOW_STOCK/medication.daysOfInventory no se toca.
      const resultado = await alertsService.sincronizar([], ['service.occupancyPct']);

      expect(resultado.resueltas).toBe(0);
      const fila = await prisma.alert.findFirstOrThrow({ where: { type: 'LOW_STOCK', scopeId: 'MED-D' } });
      expect(fila.status).toBe(AlertStatus.OPEN);
    });
  });

  describe('HTTP /api/v1/alerts', () => {
    beforeEach(limpiarAlertas);

    it('401 sin sesion', async () => {
      const res = await api().get('/api/v1/alerts');
      expect(res.status).toBe(401);
    });

    it('403 para CONSULTA, que no tiene alerts:read', async () => {
      const usuario = await crearUsuarioConRol('CONSULTA');
      const res = await api().get('/api/v1/alerts').set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(403);
    });

    it('FARMACIA solo ve alertas de ambito medication', async () => {
      await sembrarAlertaMedicamento();
      await sembrarAlertaServicio();
      const usuario = await crearUsuarioConRol('FARMACIA');

      const res = await api().get('/api/v1/alerts').set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(200);
      const ambitos = (res.body.data as { scope: string }[]).map((a) => a.scope);
      expect(ambitos.length).toBeGreaterThan(0);
      expect(ambitos.every((scope) => scope === 'medication')).toBe(true);
    });

    it('FARMACIA: GET /:id de una alerta de servicio responde 404 (fuera de su ambito)', async () => {
      const alerta = await sembrarAlertaServicio();
      const usuario = await crearUsuarioConRol('FARMACIA');

      const res = await api().get(`/api/v1/alerts/${alerta.id}`).set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(404);
    });

    it('PATCH con solo alerts:read (sin alerts:manage) responde 403', async () => {
      // DIRECTOR tiene alerts.read pero no alerts.manage.
      const alerta = await sembrarAlertaMedicamento();
      const usuario = await crearUsuarioConRol('DIRECTOR');

      const res = await api()
        .patch(`/api/v1/alerts/${alerta.id}`)
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ status: 'ACKNOWLEDGED' });
      expect(res.status).toBe(403);
    });

    it('FARMACIA reconoce una alerta de medicamento: 200 y queda auditado alert.updated', async () => {
      const alerta = await sembrarAlertaMedicamento();
      const usuario = await crearUsuarioConRol('FARMACIA');

      const res = await api()
        .patch(`/api/v1/alerts/${alerta.id}`)
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ status: 'ACKNOWLEDGED' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ACKNOWLEDGED');
      expect(res.body.data.acknowledgedAt).not.toBeNull();
      expect(res.body.data.acknowledgedBy).toBeUndefined();

      const rastro = await prisma.auditLog.findFirst({ where: { action: 'alert.updated', targetId: alerta.id } });
      expect(rastro).not.toBeNull();
      expect(rastro?.metadata).toMatchObject({ from: 'OPEN', to: 'ACKNOWLEDGED' });
    });

    it('una transicion invalida (RESOLVED -> ACKNOWLEDGED) responde 409', async () => {
      const alerta = await sembrarAlertaMedicamento(AlertStatus.RESOLVED);
      const usuario = await crearUsuarioConRol('FARMACIA');

      const res = await api()
        .patch(`/api/v1/alerts/${alerta.id}`)
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ status: 'ACKNOWLEDGED' });
      expect(res.status).toBe(409);
    });

    it('un status fuera de lo permitido por el schema responde 422', async () => {
      const alerta = await sembrarAlertaMedicamento();
      const usuario = await crearUsuarioConRol('FARMACIA');

      // El schema solo admite 'ACKNOWLEDGED' | 'RESOLVED': 'OPEN' es el estado
      // inicial del motor, nunca un destino valido por API.
      const res = await api()
        .patch(`/api/v1/alerts/${alerta.id}`)
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ status: 'OPEN' });
      expect(res.status).toBe(422);
    });

    it('un campo desconocido en la query responde 422', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .get('/api/v1/alerts?campoDesconocido=x')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(422);
    });
  });
});
