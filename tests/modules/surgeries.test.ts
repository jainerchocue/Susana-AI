import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pctSinEjecucion } from '../../src/modules/surgeries/surgeries.service';
import { api, cargarFixturesHis, crearUsuarioConRol, getApp, limpiar, prisma } from '../helpers';

/**
 * Analitica de cirugias programadas (T9), contra el fixture de
 * `ProgramacionCirugia.txt` (4 filas, una duplicada exacta -> 3 programaciones):
 *
 *   00001  paciente 1005  ingreso 5005 (URGENCIAS, en el extracto)  806104  -> 'si'   (Servicios tiene 5005/806104)
 *   00002  paciente 1006  ingreso 5006 (URGENCIAS, en el extracto)  999999  -> 'no'   (sin ese codigo en Servicios)
 *   00003  paciente 1004  ingreso 9999 (fuera del extracto)         555555  -> 'desconocido'
 *   00001  (duplicado exacto de la primera fila: se descarta en memoria)
 *
 * totalSchedules=3, distinctProcedures=3, verificables=2 (1 si / 1 no),
 * desconocidas=1, % con ingreso en extracto = 2/3 = 66.67, % ejecutadas =
 * % sin ejecucion = 1/2 = 50, byUnit = [{unit: 'URGENCIAS', count: 2}].
 */
describe('Analitica de cirugias (T9)', () => {
  beforeAll(async () => {
    await getApp();
    await limpiar();
    await cargarFixturesHis();
  }, 30_000);

  afterAll(async () => {
    await limpiar();
    await prisma.$disconnect();
  });

  it('GET /api/v1/analytics/surgeries llega al router de T9 (basePath forzado)', async () => {
    const usuario = await crearUsuarioConRol('DIRECTOR');
    const res = await api()
      .get('/api/v1/analytics/surgeries')
      .set('Authorization', `Bearer ${usuario.token}`);
    // Si el prefijo no hubiera calado (p.ej. otro router se lo hubiera
    // tragado antes), esto seria 404, no 200 con la forma esperada.
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('totalSchedules');
  });

  it('401 sin sesion', async () => {
    const res = await api().get('/api/v1/analytics/surgeries');
    expect(res.status).toBe(401);
  });

  it('FARMACIA no tiene analytics:read ni surgeries:read -> 403', async () => {
    const usuario = await crearUsuarioConRol('FARMACIA');
    const res = await api()
      .get('/api/v1/analytics/surgeries')
      .set('Authorization', `Bearer ${usuario.token}`);
    expect(res.status).toBe(403);
  });

  it('un campo desconocido en la query responde 422', async () => {
    const usuario = await crearUsuarioConRol('DIRECTOR');
    const res = await api()
      .get('/api/v1/analytics/surgeries?campoDesconocido=x')
      .set('Authorization', `Bearer ${usuario.token}`);
    expect(res.status).toBe(422);
  });

  it('resumen calculado a mano desde el fixture', async () => {
    const usuario = await crearUsuarioConRol('ANALISTA');
    const res = await api()
      .get('/api/v1/analytics/surgeries')
      .set('Authorization', `Bearer ${usuario.token}`);

    expect(res.status).toBe(200);
    const body = res.body.data as {
      totalSchedules: number;
      distinctProcedures: number;
      withAdmissionInExtract: { count: number; pct: number };
      verifiable: { total: number; executed: number; executedPct: number; notExecuted: number; notExecutedPct: number };
      unknown: number;
      topProcedures: Array<{ code: string; name: string | null; count: number }>;
      byUnit: Array<{ unit: string; count: number }>;
    };

    expect(body.totalSchedules).toBe(3);
    expect(body.distinctProcedures).toBe(3);
    expect(body.withAdmissionInExtract).toEqual({ count: 2, pct: 66.67 });
    expect(body.verifiable).toEqual({ total: 2, executed: 1, executedPct: 50, notExecuted: 1, notExecutedPct: 50 });
    expect(body.unknown).toBe(1);

    expect(body.topProcedures).toEqual([
      { code: '555555', name: null, count: 1 },
      { code: '806104', name: 'OSTEOSINTESIS', count: 1 },
      { code: '999999', name: null, count: 1 },
    ]);

    expect(body.byUnit).toEqual([{ unit: 'URGENCIAS', count: 2 }]);
  });

  it('pctSinEjecucion() (para T11) coincide con lo calculado a mano: 50%', async () => {
    await expect(pctSinEjecucion()).resolves.toBe(50);
  });

  describe('GET /api/v1/analytics/surgeries/export', () => {
    it('ANALISTA no tiene analytics:export -> 403', async () => {
      const usuario = await crearUsuarioConRol('ANALISTA');
      const res = await api()
        .get('/api/v1/analytics/surgeries/export')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(403);
    });

    it('DIRECTOR exporta el CSV: 200, text/csv y fila data.export auditada', async () => {
      const usuario = await crearUsuarioConRol('DIRECTOR');
      const res = await api()
        .get('/api/v1/analytics/surgeries/export')
        .set('Authorization', `Bearer ${usuario.token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toContain('attachment');
      const lineas = res.text.trim().split('\r\n');
      // Cabecera + 3 programaciones (la duplicada exacta no se reimporta).
      expect(lineas).toHaveLength(4);

      const rastro = await prisma.auditLog.findFirst({
        where: { action: 'data.export' },
        orderBy: { createdAt: 'desc' },
      });
      expect(rastro?.metadata).toMatchObject({ report: 'surgeries', filas: 3 });
    });
  });
});
