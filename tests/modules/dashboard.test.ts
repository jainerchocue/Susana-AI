import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlertSeverity, AlertStatus } from '@prisma/client';
import { api, cargarFixturesHis, crearUsuarioConRol, getApp, limpiar, prisma, type UsuarioPrueba } from '../helpers';
import * as occupancyService from '../../src/modules/analytics/occupancy.service';
import * as waitTimeService from '../../src/modules/analytics/wait-time.service';
import * as demandService from '../../src/modules/analytics/demand.service';

/**
 * Tests del panel (T8) contra los fixtures de `tests/fixtures/his/` (T6),
 * cargados con `cargarFixturesHis()`. Las cifras esperadas se calculan a mano
 * a partir de esos 7 archivos; ver el comentario de cada bloque para el
 * calculo. `fechaReferencia()` tras cargarlos es el `admittedAt` de la fila
 * 5006 (el ingreso mas reciente): 2026-06-06 13:00:00 hora de Colombia.
 */

const REF = new Date('2026-06-06T13:00:00-05:00');
const dia = (iso: string): Date => new Date(`${iso}T00:00:00-05:00`);

async function sembrarAlertas(): Promise<void> {
  await prisma.alert.deleteMany();
  await prisma.alert.create({
    data: {
      type: 'LOW_STOCK',
      severity: AlertSeverity.WARNING,
      status: AlertStatus.OPEN,
      scope: 'medication',
      scopeId: 'MED-1',
      metric: 'medication.daysOfInventory',
      value: 5,
      threshold: 7,
      message: 'Medicamento MED-1: 5.0 por debajo del umbral de 7.',
    },
  });
  await prisma.alert.create({
    data: {
      type: 'HIGH_OCCUPANCY',
      severity: AlertSeverity.CRITICAL,
      status: AlertStatus.OPEN,
      scope: 'service',
      scopeId: 'URGENCIAS',
      metric: 'service.occupancyPct',
      value: 96,
      threshold: 95,
      message: 'Urgencias: 96.0 por encima del umbral de 95.',
    },
  });
  // RESOLVED: no debe contar en "alertas abiertas" pase lo que pase el ambito.
  await prisma.alert.create({
    data: {
      type: 'SURGERY_CANCELLATIONS',
      severity: AlertSeverity.WARNING,
      status: AlertStatus.RESOLVED,
      scope: 'surgery',
      scopeId: null,
      metric: 'surgery.cancellationPct',
      value: 20,
      threshold: 15,
      message: 'Cirugia: 20.0 por encima del umbral de 15.',
      resolvedAt: new Date(),
    },
  });
}

describe('Dashboard (T8)', () => {
  let director: UsuarioPrueba;
  let consulta: UsuarioPrueba;
  let jefeServicio: UsuarioPrueba;

  beforeAll(async () => {
    await getApp();
    await limpiar();
    await cargarFixturesHis();
    await sembrarAlertas();
    director = await crearUsuarioConRol('DIRECTOR');
    consulta = await crearUsuarioConRol('CONSULTA');
    jefeServicio = await crearUsuarioConRol('JEFE_SERVICIO');
  }, 60_000);

  afterAll(async () => {
    await limpiar();
    await prisma.alert.deleteMany();
    await prisma.$disconnect();
  });

  describe('occupancy.service.ocupacionPorUnidad (unitario)', () => {
    it('en REF (2026-06-06 13:00): solo 5006 esta activo, en URGENCIAS', async () => {
      const filas = await occupancyService.ocupacionPorUnidad(REF);
      const urgencias = filas.find((f) => f.unit === 'URGENCIAS');
      const pediatria = filas.find((f) => f.unit === 'PEDIATRIA');

      expect(urgencias).toMatchObject({ physicalBeds: 4, census: 1, virtualCensus: 0, occupancyPct: 25 });
      expect(pediatria).toMatchObject({ physicalBeds: 1, census: 0, virtualCensus: 0, occupancyPct: 0 });
    });

    it('en 2026-06-01 09:00: solo 5001 esta activo (recien ingresado, con actividad a las 11:00)', async () => {
      const filas = await occupancyService.ocupacionPorUnidad(new Date('2026-06-01T09:00:00-05:00'));
      const urgencias = filas.find((f) => f.unit === 'URGENCIAS');
      expect(urgencias).toMatchObject({ physicalBeds: 4, census: 1, occupancyPct: 25 });
    });

    it('unidad sin camas fisicas -> insufficient_data (ninguna en los fixtures, se prueba con un instante sin ingresos)', async () => {
      // Antes del primer ingreso (2026-05-01): ninguna unidad tiene censo, pero
      // SI tiene capacidad fisica (se calcula sobre el historico completo).
      const filas = await occupancyService.ocupacionPorUnidad(new Date('2026-05-01T00:00:00-05:00'));
      expect(filas.every((f) => f.census === 0)).toBe(true);
      expect(filas.every((f) => f.occupancyPct === 0)).toBe(true);
    });
  });

  describe('occupancy.service.censoDiario (unitario)', () => {
    it('ninguna estancia de los fixtures llega a las 23:59:59 de su propio dia: censo 0 los 6 dias', async () => {
      const serie = await occupancyService.censoDiario(dia('2026-06-01'), dia('2026-06-06'));
      expect(serie).toHaveLength(6);
      expect(serie.every((d) => d.census === 0)).toBe(true);
      expect(serie.every((d) => d.occupancyPct === 0)).toBe(true);
      expect(serie[0]?.day).toBe('2026-06-01');
      expect(serie[5]?.day).toBe('2026-06-06');
    });
  });

  describe('wait-time.service (unitario)', () => {
    it('esperaPorNivel: un ingreso por nivel 1/2/3, con su espera exacta', async () => {
      const filas = await waitTimeService.esperaPorNivel(dia('2026-06-01'), dia('2026-06-07'));
      const porNivel = new Map(filas.map((f) => [f.level, f]));

      expect(porNivel.get(1)).toMatchObject({ n: 1, p50: 15, p90: 15, avg: 15 });
      expect(porNivel.get(2)).toMatchObject({ n: 1, p50: 25, p90: 25, avg: 25 });
      expect(porNivel.get(3)).toMatchObject({ n: 1, p50: 30, p90: 30, avg: 30 });
    });

    it('esperaGlobal (7 dias hasta REF): 3 ingresos con espera, mediana 25', async () => {
      const resultado = await waitTimeService.esperaGlobal(
        new Date(REF.getTime() - 7 * 24 * 60 * 60 * 1000),
        REF,
      );
      expect(resultado).toEqual({ n: 3, p50: 25 });
    });

    it('esperaGlobal sin ningun ingreso con espera -> insufficient_data', async () => {
      const resultado = await waitTimeService.esperaGlobal(
        new Date('2026-01-01T00:00:00-05:00'),
        new Date('2026-01-02T00:00:00-05:00'),
      );
      expect(resultado).toEqual({ n: 0, p50: 'insufficient_data' });
    });

    it('p50Diario: dias con un solo ingreso con espera traen esa espera; los demas, insufficient_data', async () => {
      const serie = await waitTimeService.p50Diario(dia('2026-06-01'), dia('2026-06-06'));
      const porDia = new Map(serie.map((d) => [d.day, d]));

      expect(porDia.get('2026-06-01')).toMatchObject({ n: 1, p50: 15 });
      expect(porDia.get('2026-06-02')).toMatchObject({ n: 0, p50: 'insufficient_data' });
      expect(porDia.get('2026-06-03')).toMatchObject({ n: 1, p50: 25 });
      expect(porDia.get('2026-06-04')).toMatchObject({ n: 1, p50: 30 });
      expect(porDia.get('2026-06-06')).toMatchObject({ n: 0, p50: 'insufficient_data' });
    });
  });

  describe('demand.service (unitario)', () => {
    it('cambioDemandaPorUnidad(REF): 5 ingresos en URGENCIAS y 1 en PEDIATRIA en los ultimos 7 dias; sin datos previos', async () => {
      const filas = await demandService.cambioDemandaPorUnidad(REF);
      const porUnidad = new Map(filas.map((f) => [f.unit, f]));

      expect(porUnidad.get('URGENCIAS')).toMatchObject({ last7: 5, prev7: 0, changePct: 'insufficient_data' });
      expect(porUnidad.get('PEDIATRIA')).toMatchObject({ last7: 1, prev7: 0, changePct: 'insufficient_data' });
    });

    it('conteoIngresos: 24h hasta REF trae solo el ingreso 5006; 7 dias hasta REF trae los 6', async () => {
      const ultimas24h = await demandService.conteoIngresos(
        new Date(REF.getTime() - 24 * 60 * 60 * 1000),
        REF,
      );
      const ultimos7d = await demandService.conteoIngresos(
        new Date(REF.getTime() - 7 * 24 * 60 * 60 * 1000),
        REF,
      );
      expect(ultimas24h).toBe(1);
      expect(ultimos7d).toBe(6);
    });

    it('ingresosPorViaIngreso: los 6 ingresos entran por "Urgencias"', async () => {
      const filas = await demandService.ingresosPorViaIngreso(dia('2026-06-01'), dia('2026-06-07'));
      expect(filas).toEqual([{ entryRoute: 'Urgencias', n: 6 }]);
    });

    it('perfilHorarioIngresos: un ingreso por cada hora 08,09,10,11,12,13', async () => {
      const filas = await demandService.perfilHorarioIngresos(dia('2026-06-01'), dia('2026-06-07'));
      const horas = filas.map((f) => f.hour).sort((a, b) => a - b);
      expect(horas).toEqual([8, 9, 10, 11, 12, 13]);
      expect(filas.every((f) => f.n === 1)).toBe(true);
    });
  });

  describe('HTTP /api/v1/dashboard/*', () => {
    it('401 sin sesion en los 4 endpoints', async () => {
      for (const ruta of ['summary', 'occupancy', 'wait-times', 'demand']) {
        const res = await api().get(`/api/v1/dashboard/${ruta}`);
        expect(res.status, ruta).toBe(401);
      }
    });

    it('200 para CONSULTA en /summary (solo exige dashboard:read)', async () => {
      const res = await api().get('/api/v1/dashboard/summary').set('Authorization', `Bearer ${consulta.token}`);
      expect(res.status).toBe(200);
    });

    it('403 para CONSULTA en occupancy/wait-times/demand (les falta services:read)', async () => {
      for (const ruta of ['occupancy', 'wait-times', 'demand']) {
        const res = await api().get(`/api/v1/dashboard/${ruta}`).set('Authorization', `Bearer ${consulta.token}`);
        expect(res.status, ruta).toBe(403);
      }
    });

    it('CONSULTA no ve bloque de alertas en /summary (ningun ambito visible)', async () => {
      const res = await api().get('/api/v1/dashboard/summary').set('Authorization', `Bearer ${consulta.token}`);
      expect(res.body.data.alerts).toBeUndefined();
    });

    it('DIRECTOR ve las 2 alertas abiertas (WARNING de medicamento, CRITICAL de servicio); la resuelta no cuenta', async () => {
      const res = await api().get('/api/v1/dashboard/summary').set('Authorization', `Bearer ${director.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.alerts).toEqual({ WARNING: 1, CRITICAL: 1 });
    });

    it('JEFE_SERVICIO solo ve el ambito "service": la de medicamento no cuenta (no tiene medications:read)', async () => {
      const res = await api()
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${jefeServicio.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.alerts).toEqual({ WARNING: 0, CRITICAL: 1 });
    });

    it('summary trae datosHasta = fecha de referencia, ingresos y ocupacion global correctos', async () => {
      const res = await api().get('/api/v1/dashboard/summary').set('Authorization', `Bearer ${director.token}`);
      expect(res.status).toBe(200);
      expect(new Date(res.body.data.datosHasta as string).getTime()).toBe(REF.getTime());
      expect(res.body.data.admissions).toEqual({ last24h: 1, last7d: 6, periodo: 6 });
      expect(res.body.data.occupancy).toMatchObject({
        census: 1,
        physicalBeds: 5,
        occupancyPct: 20,
        metodo: 'censo_estimado_ultima_actividad',
      });
      expect(res.body.data.waitTimeP50Minutes).toBe(25);
    });

    it('200 para DIRECTOR en occupancy/wait-times/demand, con la forma esperada', async () => {
      const occ = await api().get('/api/v1/dashboard/occupancy').set('Authorization', `Bearer ${director.token}`);
      expect(occ.status).toBe(200);
      expect(Array.isArray(occ.body.data.porUnidad)).toBe(true);
      expect(occ.body.data.metodo).toBe('censo_estimado_ultima_actividad');

      const espera = await api()
        .get('/api/v1/dashboard/wait-times')
        .set('Authorization', `Bearer ${director.token}`);
      expect(espera.status).toBe(200);
      expect(Array.isArray(espera.body.data.porNivel)).toBe(true);

      const demanda = await api().get('/api/v1/dashboard/demand').set('Authorization', `Bearer ${director.token}`);
      expect(demanda.status).toBe(200);
      expect(Array.isArray(demanda.body.data.cambioPorUnidad)).toBe(true);
    });

    it('un campo desconocido en la query responde 422', async () => {
      const res = await api()
        .get('/api/v1/dashboard/summary?campoDesconocido=x')
        .set('Authorization', `Bearer ${director.token}`);
      expect(res.status).toBe(422);
    });
  });
});
