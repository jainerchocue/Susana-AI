import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, cargarFixturesHis, crearUsuarioConRol, getApp, limpiar, prisma, type UsuarioPrueba } from '../helpers';
import * as analyticsService from '../../src/modules/analytics/analytics.service';

/**
 * Tests de analitica (T8) contra los mismos fixtures de `tests/fixtures/his/`
 * (T6). Cifras calculadas a mano; ver `Servicios.txt`/`Triage.txt` para el
 * detalle de cada fila.
 */

const dia = (iso: string): Date => new Date(`${iso}T00:00:00-05:00`);
// Rango amplio que cubre tambien el triage 7005 (2026-06-10), fuera de la
// ventana de 30 dias por defecto que usa el resto de endpoints del panel.
const DESDE_AMPLIO = dia('2026-05-01');
const HASTA_AMPLIO = dia('2026-06-15');

describe('Analytics (T8)', () => {
  let director: UsuarioPrueba;
  let analista: UsuarioPrueba;
  let consulta: UsuarioPrueba;

  beforeAll(async () => {
    await getApp();
    await limpiar();
    await cargarFixturesHis();
    director = await crearUsuarioConRol('DIRECTOR');
    analista = await crearUsuarioConRol('ANALISTA');
    consulta = await crearUsuarioConRol('CONSULTA');
  }, 60_000);

  afterAll(async () => {
    await limpiar();
    await prisma.$disconnect();
  });

  describe('analytics.service (unitario)', () => {
    it('volumenPorAreaEspecialidad: 3 grupos, el de laboratorio/medicina general es el mayor (3 lineas, cantidad 3)', async () => {
      const filas = await analyticsService.volumenPorAreaEspecialidad(dia('2026-06-01'), dia('2026-06-06'));
      expect(filas).toHaveLength(3);
      expect(filas[0]).toMatchObject({ area: 'LABORATORIO CLINICO', specialty: 'MEDICINA GENERAL', lines: 3, quantity: 3 });

      const total = filas.reduce((acc, f) => acc + f.quantity, 0);
      expect(total).toBe(5);
    });

    it('topProcedimientos: 902210 (HEMOGRAMA) es el primero, con cantidad 3', async () => {
      const filas = await analyticsService.topProcedimientos(dia('2026-06-01'), dia('2026-06-06'));
      expect(filas).toHaveLength(3);
      expect(filas[0]).toMatchObject({ code: '902210', name: 'HEMOGRAMA', quantity: 3 });
    });

    it('serieDiariaServicios: 4 dias con datos (06-02 y 06-06 no tienen ninguna linea)', async () => {
      const filas = await analyticsService.serieDiariaServicios(dia('2026-06-01'), dia('2026-06-06'));
      const porDia = new Map(filas.map((f) => [f.day, f]));
      expect(filas).toHaveLength(4);
      expect(porDia.get('2026-06-01')).toMatchObject({ lines: 2, quantity: 2 });
      expect(porDia.get('2026-06-03')).toMatchObject({ lines: 1, quantity: 1 });
      expect(porDia.get('2026-06-04')).toMatchObject({ lines: 1, quantity: 1 });
      expect(porDia.get('2026-06-05')).toMatchObject({ lines: 1, quantity: 1 });
      expect(porDia.has('2026-06-02')).toBe(false);
    });

    it('distribucionTriagePorNivel: un triage por nivel 1-4 (incluye el 7005 del rango amplio)', async () => {
      const filas = await analyticsService.distribucionTriagePorNivel(DESDE_AMPLIO, HASTA_AMPLIO);
      const porNivel = new Map(filas.map((f) => [f.level, f.n]));
      expect(porNivel.get(1)).toBe(1);
      expect(porNivel.get(2)).toBe(1);
      expect(porNivel.get(3)).toBe(1);
      expect(porNivel.get(4)).toBe(1);
    });

    it('distribucionTriagePorClasificacion: 4 clasificaciones distintas, todas con 1', async () => {
      const filas = await analyticsService.distribucionTriagePorClasificacion(DESDE_AMPLIO, HASTA_AMPLIO);
      expect(filas).toHaveLength(4);
      expect(filas.every((f) => f.n === 1)).toBe(true);
    });

    it('perfilHorarioTriage: hora 9 junta 2 triages (7003 y 7005), horas 7 y 10 tienen 1 cada una', async () => {
      const filas = await analyticsService.perfilHorarioTriage(DESDE_AMPLIO, HASTA_AMPLIO);
      const porHora = new Map(filas.map((f) => [f.hour, f.n]));
      expect(porHora.get(7)).toBe(1);
      expect(porHora.get(9)).toBe(2);
      expect(porHora.get(10)).toBe(1);
    });
  });

  describe('HTTP /api/v1/analytics/*', () => {
    it('401 sin sesion', async () => {
      for (const ruta of ['services', 'triage', 'services/export', 'triage/export']) {
        const res = await api().get(`/api/v1/analytics/${ruta}`);
        expect(res.status, ruta).toBe(401);
      }
    });

    it('403 para CONSULTA (le falta analytics:read y services:read)', async () => {
      for (const ruta of ['services', 'triage']) {
        const res = await api().get(`/api/v1/analytics/${ruta}`).set('Authorization', `Bearer ${consulta.token}`);
        expect(res.status, ruta).toBe(403);
      }
    });

    it('200 para DIRECTOR y ANALISTA en /services y /triage', async () => {
      for (const usuario of [director, analista]) {
        const services = await api()
          .get('/api/v1/analytics/services')
          .set('Authorization', `Bearer ${usuario.token}`);
        expect(services.status).toBe(200);
        expect(Array.isArray(services.body.data.porAreaEspecialidad)).toBe(true);

        const triage = await api()
          .get(`/api/v1/analytics/triage?desde=${DESDE_AMPLIO.toISOString()}&hasta=${HASTA_AMPLIO.toISOString()}`)
          .set('Authorization', `Bearer ${usuario.token}`);
        expect(triage.status).toBe(200);
        expect(Array.isArray(triage.body.data.esperaPorNivel)).toBe(true);
      }
    });

    it('DIRECTOR: /services/export responde CSV y deja una fila data.export', async () => {
      const res = await api()
        .get('/api/v1/analytics/services/export')
        .set('Authorization', `Bearer ${director.token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.text).toContain('"area","specialty","lines","quantity"');
      expect(res.text).toContain('LABORATORIO CLINICO');

      const fila = await prisma.auditLog.findFirst({
        where: { action: 'data.export', targetType: 'analytics.services', actorId: director.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(fila).not.toBeNull();
    });

    it('DIRECTOR: /triage/export responde CSV', async () => {
      const res = await api()
        .get(`/api/v1/analytics/triage/export?desde=${DESDE_AMPLIO.toISOString()}&hasta=${HASTA_AMPLIO.toISOString()}`)
        .set('Authorization', `Bearer ${director.token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.text).toContain('"level","n","p50","p90","avg"');
    });

    it('ANALISTA: los export responden 403 (no tiene analytics:export)', async () => {
      for (const ruta of ['services/export', 'triage/export']) {
        const res = await api().get(`/api/v1/analytics/${ruta}`).set('Authorization', `Bearer ${analista.token}`);
        expect(res.status, ruta).toBe(403);
      }
    });

    it('un campo desconocido en la query responde 422', async () => {
      const res = await api()
        .get('/api/v1/analytics/services?campoDesconocido=x')
        .set('Authorization', `Bearer ${director.token}`);
      expect(res.status).toBe(422);
    });
  });
});
