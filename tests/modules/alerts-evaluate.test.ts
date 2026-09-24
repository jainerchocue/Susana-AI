import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AlertSeverity, AlertStatus } from '@prisma/client';
import { construirMetricas, METRICAS_EVALUADAS } from '../../src/modules/alerts/alerts.metrics';
import { evaluarReglas, UMBRALES } from '../../src/modules/alerts/alerts.engine';
import { api, cargarFixturesHis, crearUsuarioConRol, getApp, limpiar, prisma } from '../helpers';

/**
 * Conecta el motor de reglas (T3, puro) con los datos HIS reales de los
 * fixtures de `tests/fixtures/his/` (T6), a traves de `alerts.metrics.ts` y de
 * `POST /alerts/evaluate` (T11).
 *
 * Cifras calculadas A MANO contra los fixtures (ver `tests/modules/his-import.test.ts`
 * para los derivados que las sustentan):
 *  - `fechaReferencia()` = max(admittedAt) = el ingreso 5006, 2026-06-06 13:00:00.
 *  - En ese instante solo el ingreso 5006 sigue "activo" (admittedAt <=
 *    referencia <= lastActivityAt): URGENCIAS tiene 4 camas fisicas (U-01..U-04;
 *    V-01 es virtual) y censo 1 -> 25% de ocupacion; PEDIATRIA tiene 1 cama
 *    fisica (P-01) y censo 0 -> 0%. Ambas muy por debajo de ALERT_OCCUPANCY_PCT
 *    (85 por defecto): no generan HIGH_OCCUPANCY.
 *  - Espera por nivel (7 dias hasta la referencia): nivel 1 = 15 min (5001),
 *    nivel 2 = 25 min (5003), nivel 3 = 30 min (5004). Muy por debajo de
 *    ALERT_WAIT_MINUTES (60): no generan LONG_WAIT.
 *  - Cambio de demanda: los 6 ingresos caen en la ventana de "ultimos 7 dias"
 *    y la ventana "previa" no tiene ninguno -> `prev7 = 0` -> 'insufficient_data'
 *    en ambas unidades: nunca genera alerta (DEMAND_SPIKE).
 *  - Medicamentos: `cargarFixturesHis()` no crea ningun `MedicationStock` ->
 *    `diasInventario()` devuelve `[]`: no hay puntos de esa metrica, no hay
 *    LOW_STOCK.
 *  - Cirugias: 3 programaciones distintas (una duplicada exacta se descarta en
 *    la importacion). De ellas, 2 son verificables (ingreso en el extracto):
 *    5005/806104 SI se ejecuto (aparece en Servicios) y 5006/999999 NO. La
 *    tercera (ingreso 9999, fuera del extracto) es 'desconocido' y no cuenta
 *    como verificable. `pctSinEjecucion` = 1/2 * 100 = 50%, por encima de
 *    ALERT_SURGERY_CANCELLATION_PCT (15 por defecto) -> SURGERY_CANCELLATIONS
 *    WARNING (esta regla no tiene nivel CRITICAL), scope 'surgery', scopeId null.
 *
 * Con los umbrales por defecto (sin overrides en tests/setup.ts), la unica
 * alerta que debe salir de estos fixtures es esa.
 */

async function limpiarAlertas(): Promise<void> {
  await prisma.alert.deleteMany();
}

describe('Motor de alertas conectado a datos HIS (T11)', () => {
  beforeAll(async () => {
    await getApp();
    await limpiar();
    await limpiarAlertas();
    await cargarFixturesHis();
  });

  afterAll(async () => {
    await limpiar();
    await limpiarAlertas();
    await prisma.$disconnect();
  });

  describe('alerts.metrics · construirMetricas', () => {
    it('produce un punto por unidad/nivel/medicamento, mas el unico de cirugia', async () => {
      const puntos = await construirMetricas();

      // 2 unidades (occupancy) + 2 unidades (demand) + 3 niveles (wait) + 0
      // medicamentos (sin stock) + 1 de cirugia (scope unico) = 8.
      expect(puntos).toHaveLength(8);
      expect(puntos.filter((p) => p.metric === 'medication.daysOfInventory')).toHaveLength(0);

      const cirugia = puntos.find((p) => p.metric === 'surgery.cancellationPct');
      expect(cirugia).toMatchObject({ scope: 'surgery', scopeId: null, value: 50 });

      const esperaNivel1 = puntos.find((p) => p.metric === 'triage.waitMinutesP50' && p.scopeId === 'nivel-1');
      expect(esperaNivel1?.value).toBeCloseTo(15, 5);

      const ocupacionUrgencias = puntos.find((p) => p.metric === 'service.occupancyPct' && p.scopeId === 'URGENCIAS');
      expect(ocupacionUrgencias?.value).toBeCloseTo(25, 5);

      // prev7 = 0 en ambas unidades: dato insuficiente, nunca genera alerta.
      const demandas = puntos.filter((p) => p.metric === 'service.demandChangePct');
      expect(demandas.every((p) => p.value === 'insufficient_data')).toBe(true);
    });

    it('evaluarReglas sobre esos puntos deja solo la alerta de cirugia, con los umbrales por defecto', async () => {
      const puntos = await construirMetricas();
      const candidatos = evaluarReglas(puntos, UMBRALES);

      expect(candidatos).toHaveLength(1);
      expect(candidatos[0]).toMatchObject({
        type: 'SURGERY_CANCELLATIONS',
        severity: AlertSeverity.WARNING,
        scope: 'surgery',
        scopeId: null,
        metric: 'surgery.cancellationPct',
        value: 50,
        threshold: UMBRALES.surgeryCancellationPct,
      });
    });

    it('METRICAS_EVALUADAS cubre las 5 metricas del motor', () => {
      expect(METRICAS_EVALUADAS.sort()).toEqual(
        [
          'medication.daysOfInventory',
          'service.occupancyPct',
          'triage.waitMinutesP50',
          'service.demandChangePct',
          'surgery.cancellationPct',
        ].sort(),
      );
    });
  });

  describe('POST /api/v1/alerts/evaluate', () => {
    beforeEach(limpiarAlertas);

    it('401 sin sesion', async () => {
      const res = await api().post('/api/v1/alerts/evaluate');
      expect(res.status).toBe(401);
    });

    it('403 para DIRECTOR, que tiene alerts:read pero no alerts:manage', async () => {
      const usuario = await crearUsuarioConRol('DIRECTOR');
      const res = await api().post('/api/v1/alerts/evaluate').set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(403);
    });

    it('FARMACIA crea exactamente la alerta de cirugia esperada', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');

      const res = await api().post('/api/v1/alerts/evaluate').set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ creadas: 1, actualizadas: 0, resueltas: 0 });
      expect(typeof res.body.data.evaluadoEn).toBe('string');

      const alertas = await prisma.alert.findMany();
      expect(alertas).toHaveLength(1);
      expect(alertas[0]).toMatchObject({
        type: 'SURGERY_CANCELLATIONS',
        severity: AlertSeverity.WARNING,
        status: AlertStatus.OPEN,
        scope: 'surgery',
        scopeId: null,
        value: 50,
        threshold: UMBRALES.surgeryCancellationPct,
      });

      const rastro = await prisma.auditLog.findFirst({
        where: { action: 'alert.evaluated', actorId: usuario.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(rastro).not.toBeNull();
      expect(rastro?.metadata).toMatchObject({ creadas: 1, actualizadas: 0, resueltas: 0 });
    });

    it('relanzar la evaluacion no duplica: la segunda pasada actualiza, no crea', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const auth = { 'Authorization': `Bearer ${usuario.token}` };

      const primera = await api().post('/api/v1/alerts/evaluate').set(auth);
      expect(primera.body.data).toMatchObject({ creadas: 1, actualizadas: 0 });

      const segunda = await api().post('/api/v1/alerts/evaluate').set(auth);
      expect(segunda.status).toBe(200);
      expect(segunda.body.data).toMatchObject({ creadas: 0, actualizadas: 1, resueltas: 0 });

      const alertas = await prisma.alert.findMany({ where: { type: 'SURGERY_CANCELLATIONS' } });
      expect(alertas).toHaveLength(1);
    });

    it('si la cirugia deja de superar el umbral, la siguiente pasada la resuelve', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const auth = { 'Authorization': `Bearer ${usuario.token}` };

      await api().post('/api/v1/alerts/evaluate').set(auth);
      const abierta = await prisma.alert.findFirstOrThrow({ where: { type: 'SURGERY_CANCELLATIONS' } });
      expect(abierta.status).toBe(AlertStatus.OPEN);

      // Se sube el umbral por encima del 50% real marcando TODAS las cirugias
      // verificables como ejecutadas: pctSinEjecucion pasa a 0%, por debajo del
      // umbral, y la pasada siguiente debe resolver la alerta existente.
      await prisma.surgerySchedule.updateMany({ where: { executed: 'no' }, data: { executed: 'si' } });

      const res = await api().post('/api/v1/alerts/evaluate').set(auth);
      expect(res.body.data).toMatchObject({ creadas: 0, actualizadas: 0, resueltas: 1 });

      const resuelta = await prisma.alert.findUniqueOrThrow({ where: { id: abierta.id } });
      expect(resuelta.status).toBe(AlertStatus.RESOLVED);
      expect(resuelta.resolvedAt).not.toBeNull();

      // Deja los fixtures como estaban para el resto de tests de este archivo.
      await prisma.surgerySchedule.updateMany({
        where: { admissionId: 5006, procedureCode: '999999' },
        data: { executed: 'no' },
      });
    });
  });
});
