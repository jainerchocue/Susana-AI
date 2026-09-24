import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AlertSeverity, AlertStatus } from '@prisma/client';
import * as alertsService from '../../src/modules/alerts/alerts.service';
import { ALERT_TYPES, UMBRALES_ALERTA_POR_DEFECTO } from '../../src/modules/alerts/alerts.constants';
import { api, cargarFixturesHis, crearUsuarioConRol, getApp, limpiar, prisma } from '../helpers';

/**
 * TC5: reglas del motor en BD (AlertRule), alertas manuales y su borrado.
 *
 * Comparte `hospital_test_e` con `alerts.test.ts`/`alerts-evaluate.test.ts`
 * (mismo patron, otra tarea): `vitest.config.mts` fija `fileParallelism:
 * false`, asi que los archivos nunca corren a la vez, pero SI comparten la
 * tabla `alert_rules` entre archivos que se ejecuten en la misma corrida.
 * `restaurarReglas()` deja las 5 filas en sus valores de env (los del seed)
 * tanto al empezar como al terminar, para que el orden de ejecucion nunca
 * importe.
 */

async function restaurarReglas(): Promise<void> {
  for (const type of ALERT_TYPES) {
    const defecto = UMBRALES_ALERTA_POR_DEFECTO[type];
    await prisma.alertRule.update({
      where: { type },
      data: {
        enabled: true,
        warningThreshold: defecto.warningThreshold,
        criticalThreshold: defecto.criticalThreshold,
      },
    });
  }
}

async function limpiarAlertas(): Promise<void> {
  await prisma.alert.deleteMany();
}

describe('Reglas del motor en BD y alertas manuales (TC5)', () => {
  beforeAll(async () => {
    await getApp();
    await limpiar();
    await limpiarAlertas();
    await restaurarReglas();
    await cargarFixturesHis();
  });

  afterAll(async () => {
    await limpiar();
    await limpiarAlertas();
    await restaurarReglas();
    await prisma.$disconnect();
  });

  describe('GET /api/v1/alerts/rules[/:type]', () => {
    it('401 sin sesion', async () => {
      const res = await api().get('/api/v1/alerts/rules');
      expect(res.status).toBe(401);
    });

    it('403 para CONSULTA, que no tiene alerts:read', async () => {
      const usuario = await crearUsuarioConRol('CONSULTA');
      const res = await api().get('/api/v1/alerts/rules').set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(403);
    });

    it('lista las 5 reglas con los umbrales por defecto', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api().get('/api/v1/alerts/rules').set('Authorization', `Bearer ${usuario.token}`);

      expect(res.status).toBe(200);
      const filas = res.body.data as { type: string; enabled: boolean; warningThreshold: number }[];
      expect(filas).toHaveLength(5);
      expect(filas.map((f) => f.type).sort()).toEqual([...ALERT_TYPES].sort());
      expect(filas.every((f) => f.enabled)).toBe(true);
    });

    it('GET /rules/:type con un tipo desconocido responde 422 (no cae en "/:id")', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .get('/api/v1/alerts/rules/NO_EXISTE')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(422);
    });

    it('GET /rules/LOW_STOCK devuelve exactamente el umbral por defecto', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .get('/api/v1/alerts/rules/LOW_STOCK')
        .set('Authorization', `Bearer ${usuario.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        type: 'LOW_STOCK',
        enabled: true,
        warningThreshold: UMBRALES_ALERTA_POR_DEFECTO.LOW_STOCK.warningThreshold,
        criticalThreshold: UMBRALES_ALERTA_POR_DEFECTO.LOW_STOCK.criticalThreshold,
      });
    });
  });

  describe('PATCH /api/v1/alerts/rules/:type', () => {
    afterAll(restaurarReglas);

    it('403 para FARMACIA (alerts:manage, pero no system:manage)', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .patch('/api/v1/alerts/rules/LOW_STOCK')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ warningThreshold: 5 });
      expect(res.status).toBe(403);
    });

    it('cuerpo vacio responde 422 ("envia al menos un campo")', async () => {
      const usuario = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .patch('/api/v1/alerts/rules/LOW_STOCK')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({});
      expect(res.status).toBe(422);
    });

    it('LOW_STOCK: criticalThreshold >= warningThreshold responde 422 (coherencia)', async () => {
      const usuario = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .patch('/api/v1/alerts/rules/LOW_STOCK')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ warningThreshold: 7, criticalThreshold: 9 });
      expect(res.status).toBe(422);
    });

    it('HIGH_OCCUPANCY: criticalThreshold <= warningThreshold responde 422 (coherencia inversa)', async () => {
      const usuario = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .patch('/api/v1/alerts/rules/HIGH_OCCUPANCY')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ warningThreshold: 90, criticalThreshold: 80 });
      expect(res.status).toBe(422);
    });

    it('DEMAND_SPIKE (un solo nivel) rechaza un criticalThreshold no nulo', async () => {
      const usuario = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .patch('/api/v1/alerts/rules/DEMAND_SPIKE')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ criticalThreshold: 50 });
      expect(res.status).toBe(422);
    });

    it('ADMIN cambia solo warningThreshold: criticalThreshold no cambia y queda auditado', async () => {
      const usuario = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .patch('/api/v1/alerts/rules/LOW_STOCK')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ warningThreshold: 5 });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        type: 'LOW_STOCK',
        warningThreshold: 5,
        criticalThreshold: UMBRALES_ALERTA_POR_DEFECTO.LOW_STOCK.criticalThreshold,
      });

      const rastro = await prisma.auditLog.findFirst({
        where: { action: 'alert.rule.updated', actorId: usuario.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(rastro).not.toBeNull();
      expect(rastro?.metadata).toMatchObject({ type: 'LOW_STOCK', to: { warningThreshold: 5 } });

      await restaurarReglas();
    });

    it('ADMIN desactiva una regla: enabled=false, sin tocar los umbrales', async () => {
      const usuario = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .patch('/api/v1/alerts/rules/DEMAND_SPIKE')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        type: 'DEMAND_SPIKE',
        enabled: false,
        warningThreshold: UMBRALES_ALERTA_POR_DEFECTO.DEMAND_SPIKE.warningThreshold,
      });

      await restaurarReglas();
    });
  });

  /**
   * Cifras del fixture (documentadas en detalle en alerts-evaluate.test.ts):
   * `pctSinEjecucion` = 50%, por encima del umbral por defecto de
   * SURGERY_CANCELLATIONS (15) -> WARNING. Se usa aqui para probar que un
   * umbral cambiado por API cambia lo que genera el motor, sin depender de
   * datos sinteticos propios.
   */
  describe('Un umbral cambiado por API cambia lo que genera POST /alerts/evaluate', () => {
    beforeEach(async () => {
      await limpiarAlertas();
      await restaurarReglas();
    });

    it('subir el umbral de SURGERY_CANCELLATIONS por encima del 50% real dejar de generar/resolver la alerta', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const admin = await crearUsuarioConRol('ADMIN');

      const primera = await api()
        .post('/api/v1/alerts/evaluate')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(primera.body.data).toMatchObject({ creadas: 1 });
      const abierta = await prisma.alert.findFirstOrThrow({ where: { type: 'SURGERY_CANCELLATIONS' } });
      expect(abierta.status).toBe(AlertStatus.OPEN);
      expect(abierta.threshold).toBe(UMBRALES_ALERTA_POR_DEFECTO.SURGERY_CANCELLATIONS.warningThreshold);

      const patch = await api()
        .patch('/api/v1/alerts/rules/SURGERY_CANCELLATIONS')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ warningThreshold: 60 });
      expect(patch.status).toBe(200);

      const segunda = await api()
        .post('/api/v1/alerts/evaluate')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(segunda.body.data).toMatchObject({ creadas: 0, resueltas: 1 });
      const resuelta = await prisma.alert.findUniqueOrThrow({ where: { id: abierta.id } });
      expect(resuelta.status).toBe(AlertStatus.RESOLVED);

      await restaurarReglas();
    });

    it('desactivar SURGERY_CANCELLATIONS resuelve la abierta y deja de generarla; reactivarla la recrea', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const admin = await crearUsuarioConRol('ADMIN');

      await api().post('/api/v1/alerts/evaluate').set('Authorization', `Bearer ${usuario.token}`);
      const abierta = await prisma.alert.findFirstOrThrow({ where: { type: 'SURGERY_CANCELLATIONS' } });
      expect(abierta.status).toBe(AlertStatus.OPEN);

      await api()
        .patch('/api/v1/alerts/rules/SURGERY_CANCELLATIONS')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ enabled: false });

      const trasDesactivar = await api()
        .post('/api/v1/alerts/evaluate')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(trasDesactivar.body.data).toMatchObject({ creadas: 0, resueltas: 1 });
      expect((await prisma.alert.findUniqueOrThrow({ where: { id: abierta.id } })).status).toBe(
        AlertStatus.RESOLVED,
      );

      // Sigue desactivada: una segunda pasada no la recrea.
      const otraVezDesactivada = await api()
        .post('/api/v1/alerts/evaluate')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(otraVezDesactivada.body.data).toMatchObject({ creadas: 0 });
      expect(await prisma.alert.count({ where: { type: 'SURGERY_CANCELLATIONS', status: AlertStatus.OPEN } })).toBe(
        0,
      );

      await api()
        .patch('/api/v1/alerts/rules/SURGERY_CANCELLATIONS')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ enabled: true });

      const trasReactivar = await api()
        .post('/api/v1/alerts/evaluate')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(trasReactivar.body.data).toMatchObject({ creadas: 1 });

      await restaurarReglas();
    });
  });

  describe('alerts.service · sincronizar nunca resuelve ni pisa una alerta manual', () => {
    const actorId = randomUUID();

    beforeEach(limpiarAlertas);

    it('un candidato del motor con la misma clave (type, scopeId) crea una fila aparte, sin tocar la manual', async () => {
      const manual = await alertsService.createManual(
        {
          type: 'LOW_STOCK',
          severity: AlertSeverity.WARNING,
          scope: 'medication',
          scopeId: 'MED-COLISION',
          message: 'Nota manual de un operador: revisar con el proveedor.',
        },
        ['medication'],
        actorId,
        {},
      );
      expect(manual.source).toBe('manual');
      expect(manual.value).toBe(0);
      expect(manual.threshold).toBe(0);

      const candidato = {
        type: 'LOW_STOCK' as const,
        severity: AlertSeverity.CRITICAL,
        scope: 'medication' as const,
        scopeId: 'MED-COLISION',
        metric: 'medication.daysOfInventory' as const,
        value: 1.5,
        threshold: 3,
        message: 'Candidato del motor para la misma clave.',
      };

      const resultado = await alertsService.sincronizar([candidato], ['medication.daysOfInventory']);
      // No encuentra un "engine" existente con esa clave (la manual no cuenta): crea uno nuevo.
      expect(resultado).toEqual({ creadas: 1, actualizadas: 0, resueltas: 0 });

      const filas = await prisma.alert.findMany({ where: { type: 'LOW_STOCK', scopeId: 'MED-COLISION' } });
      expect(filas).toHaveLength(2);
      const filaManual = filas.find((f) => f.source === 'manual');
      const filaMotor = filas.find((f) => f.source === 'engine');
      expect(filaManual?.message).toBe('Nota manual de un operador: revisar con el proveedor.');
      expect(filaManual?.value).toBe(0);
      expect(filaMotor?.value).toBe(1.5);

      // Segunda pasada sin ese candidato: solo la del motor se resuelve; la manual sigue OPEN.
      const segunda = await alertsService.sincronizar([], ['medication.daysOfInventory']);
      expect(segunda).toEqual({ creadas: 0, actualizadas: 0, resueltas: 1 });

      const trasResolver = await prisma.alert.findMany({ where: { type: 'LOW_STOCK', scopeId: 'MED-COLISION' } });
      expect(trasResolver.find((f) => f.source === 'manual')?.status).toBe(AlertStatus.OPEN);
      expect(trasResolver.find((f) => f.source === 'engine')?.status).toBe(AlertStatus.RESOLVED);
    });
  });

  describe('POST /api/v1/alerts (manual) y DELETE /api/v1/alerts/:id', () => {
    beforeEach(limpiarAlertas);

    it('401 sin sesion', async () => {
      const res = await api().post('/api/v1/alerts');
      expect(res.status).toBe(401);
    });

    it('FARMACIA no puede crear una manual de scope "service" (fuera de su ambito): 403', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .post('/api/v1/alerts')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ type: 'HIGH_OCCUPANCY', severity: 'WARNING', scope: 'service', message: 'Nota fuera de ambito.' });
      expect(res.status).toBe(403);
    });

    it('FARMACIA crea una manual de scope "medication": 201, source manual, auditada', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .post('/api/v1/alerts')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({
          type: 'LOW_STOCK',
          severity: 'CRITICAL',
          scope: 'medication',
          scopeId: 'MED-MANUAL-1',
          message: 'Proveedor confirma retraso de una semana.',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        type: 'LOW_STOCK',
        severity: 'CRITICAL',
        status: 'OPEN',
        scope: 'medication',
        scopeId: 'MED-MANUAL-1',
        source: 'manual',
        value: 0,
        threshold: 0,
      });

      const rastro = await prisma.auditLog.findFirst({
        where: { action: 'alert.created', targetId: res.body.data.id },
      });
      expect(rastro).not.toBeNull();
    });

    it('un campo desconocido en el body responde 422 (.strict())', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .post('/api/v1/alerts')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({
          type: 'LOW_STOCK',
          severity: 'WARNING',
          scope: 'medication',
          message: 'x',
          value: 99,
        });
      expect(res.status).toBe(422);
    });

    it('DELETE con solo alerts:read (DIRECTOR) responde 403', async () => {
      const manual = await alertsService.createManual(
        { type: 'LOW_STOCK', severity: AlertSeverity.WARNING, scope: 'medication', message: 'x' },
        ['medication'],
        randomUUID(),
        {},
      );
      const director = await crearUsuarioConRol('DIRECTOR');
      const res = await api()
        .delete(`/api/v1/alerts/${manual.id}`)
        .set('Authorization', `Bearer ${director.token}`);
      expect(res.status).toBe(403);
    });

    it('una manual se puede borrar (204) y despues responde 404', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const manual = await alertsService.createManual(
        { type: 'LOW_STOCK', severity: AlertSeverity.WARNING, scope: 'medication', message: 'Nota a borrar.' },
        ['medication'],
        usuario.id,
        {},
      );

      const del = await api().delete(`/api/v1/alerts/${manual.id}`).set('Authorization', `Bearer ${usuario.token}`);
      expect(del.status).toBe(204);

      const get = await api().get(`/api/v1/alerts/${manual.id}`).set('Authorization', `Bearer ${usuario.token}`);
      expect(get.status).toBe(404);

      const rastro = await prisma.auditLog.findFirst({ where: { action: 'alert.deleted', targetId: manual.id } });
      expect(rastro).not.toBeNull();
    });

    it('una alerta del motor abierta (OPEN) no se puede borrar: 409', async () => {
      const alerta = await prisma.alert.create({
        data: {
          type: 'LOW_STOCK',
          severity: AlertSeverity.CRITICAL,
          scope: 'medication',
          scopeId: 'MED-NO-BORRAR',
          metric: 'medication.daysOfInventory',
          value: 1,
          threshold: 3,
          message: 'Alerta del motor, sin resolver.',
        },
      });
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api().delete(`/api/v1/alerts/${alerta.id}`).set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(409);
    });

    it('una alerta del motor RESOLVED si se puede borrar: 204', async () => {
      const alerta = await prisma.alert.create({
        data: {
          type: 'LOW_STOCK',
          severity: AlertSeverity.CRITICAL,
          status: AlertStatus.RESOLVED,
          scope: 'medication',
          scopeId: 'MED-RESUELTA',
          metric: 'medication.daysOfInventory',
          value: 1,
          threshold: 3,
          message: 'Alerta del motor, ya resuelta.',
          resolvedAt: new Date(),
        },
      });
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api().delete(`/api/v1/alerts/${alerta.id}`).set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(204);
    });
  });
});
