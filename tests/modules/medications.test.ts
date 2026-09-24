import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fechaReferencia } from '../../src/modules/his/his.periodo';
import { diasInventario } from '../../src/modules/medications/medications.service';
import { api, cargarFixturesHis, crearUsuarioConRol, getApp, limpiar, prisma } from '../helpers';

/**
 * Modulo de medicamentos e insumos (T9), contra los fixtures de
 * `tests/fixtures/his` (MedicamentoInsumo.txt: 4 dispensaciones, 4 codigos).
 *
 * Cifras a mano (B0 + import-data.ts): "DM..." es insumo, el resto medicamento.
 *   B05BM002702 MANITOL SOLUCION   medicamento  qty=2  2026-06-01 area=FARMACIA
 *   DMT0000007  TUBO DE TORAX      insumo       qty=1  2026-06-03 area=CIRUGIA
 *   DMC0000392  CATETER SUCCION    insumo       qty=1  2026-06-04 area=UCI
 *   N02BE01     ACETAMINOFEN TAB.  medicamento  qty=3  2026-06-06 area=FARMACIA
 * Fecha de referencia = max(admittedAt) = 2026-06-06 13:00 -05:00: todas caen
 * dentro de la ventana de 30 dias por defecto.
 */
describe('Modulo de medicamentos (T9)', () => {
  beforeAll(async () => {
    await getApp();
    await limpiar();
    await cargarFixturesHis();
  }, 30_000);

  afterAll(async () => {
    await prisma.medicationStock.deleteMany();
    await limpiar();
    await prisma.$disconnect();
  });

  describe('GET /api/v1/medications', () => {
    it('401 sin sesion', async () => {
      const res = await api().get('/api/v1/medications');
      expect(res.status).toBe(401);
    });

    it('403 para CONSULTA (no tiene medications:read)', async () => {
      const usuario = await crearUsuarioConRol('CONSULTA');
      const res = await api().get('/api/v1/medications').set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(403);
    });

    it('lista el catalogo completo con cantidad/lineas del periodo y kind por prefijo DM', async () => {
      const usuario = await crearUsuarioConRol('DIRECTOR');
      const res = await api().get('/api/v1/medications').set('Authorization', `Bearer ${usuario.token}`);

      expect(res.status).toBe(200);
      const items = res.body.data as Array<Record<string, unknown>>;
      expect(items).toHaveLength(4);
      expect(res.body.pagination).toMatchObject({ total: 4, page: 1, limit: 20 });

      const manitol = items.find((i) => i.code === 'B05BM002702');
      expect(manitol).toMatchObject({
        name: 'MANITOL SOLUCION',
        kind: 'medicamento',
        quantity: 2,
        lines: 1,
        stock: null,
        avgDailyConsumption: 'insufficient_data',
        daysOfInventory: 'insufficient_data',
        risk: 'insufficient_data',
        rotation: 'insufficient_data',
      });
      expect(manitol?.lastDispensedAt).toBe(new Date('2026-06-01T16:00:00.000Z').toISOString());

      expect(items.find((i) => i.code === 'DMT0000007')).toMatchObject({ kind: 'insumo', quantity: 1 });
      expect(items.find((i) => i.code === 'DMC0000392')).toMatchObject({ kind: 'insumo', quantity: 1 });

      // N02BE01 se dispensa el 06-06 a las 14:00 local, una hora DESPUES de
      // `hasta` por defecto (= fecha de referencia = 06-06 13:00 local, el
      // `admittedAt` mas tardio): cae fuera del periodo por defecto, aunque
      // `lastDispensedAt` (global, sin filtro de periodo) si la recoge.
      const acetaminofen = items.find((i) => i.code === 'N02BE01');
      expect(acetaminofen).toMatchObject({ kind: 'medicamento', quantity: 0, lines: 0 });
      expect(acetaminofen?.lastDispensedAt).toBe('2026-06-06T19:00:00.000Z');
    });

    it('filtra por kind=insumo', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .get('/api/v1/medications?kind=insumo')
        .set('Authorization', `Bearer ${usuario.token}`);

      expect(res.status).toBe(200);
      const codes = (res.body.data as Array<{ code: string }>).map((i) => i.code).sort();
      expect(codes).toEqual(['DMC0000392', 'DMT0000007']);
    });

    it('busca por nombre con ILIKE insensible a mayusculas', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .get('/api/v1/medications?search=manitol')
        .set('Authorization', `Bearer ${usuario.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].code).toBe('B05BM002702');
    });

    it('un campo desconocido en la query responde 422', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .get('/api/v1/medications?campoDesconocido=x')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(422);
    });
  });

  describe('GET /api/v1/medications/consumption', () => {
    it('serie diaria, top-10 y desglose por area calculados a mano desde los fixtures', async () => {
      const usuario = await crearUsuarioConRol('ANALISTA');
      const res = await api()
        .get('/api/v1/medications/consumption')
        .set('Authorization', `Bearer ${usuario.token}`);

      expect(res.status).toBe(200);
      const body = res.body.data as {
        series: Array<{ date: string; quantity: number }>;
        top: Array<{ code: string; name: string; quantity: number }>;
        byArea: Array<{ area: string; quantity: number }>;
      };

      // `hasta` por defecto = fecha de referencia (max admittedAt = 06-06
      // 13:00 local). La dispensacion de N02BE01 es a las 14:00 local ese
      // mismo dia, una hora DESPUES: queda fuera del periodo por defecto.
      // Quedan 3 dias con actividad: 06-01 (2), 06-03 (1) y 06-04 (1).
      expect(body.series).toHaveLength(3);
      expect(body.series.map((s) => s.quantity)).toEqual([2, 1, 1]);

      expect(body.top.map((t) => ({ code: t.code, quantity: t.quantity }))).toEqual([
        { code: 'B05BM002702', quantity: 2 },
        { code: 'DMC0000392', quantity: 1 },
        { code: 'DMT0000007', quantity: 1 },
      ]);

      expect(body.byArea).toEqual([
        { area: 'FARMACIA', quantity: 2 },
        { area: 'CIRUGIA', quantity: 1 },
        { area: 'UCI', quantity: 1 },
      ]);
    });

    it('filtra la serie por code sin afectar el top-10 global, con un periodo explicito', async () => {
      const usuario = await crearUsuarioConRol('ANALISTA');
      // `hasta` explicito para incluir la dispensacion de N02BE01 (06-06
      // 14:00 local), que el periodo por defecto deja fuera (ver test anterior).
      const res = await api()
        .get('/api/v1/medications/consumption?code=N02BE01&hasta=2026-06-07T00:00:00.000Z')
        .set('Authorization', `Bearer ${usuario.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.series).toHaveLength(1);
      expect(res.body.data.series[0].quantity).toBe(3);
      // El top-10 no lo filtra `code`: con el periodo ampliado, N02BE01(3) vuelve a entrar y encabeza.
      expect(res.body.data.top[0]).toMatchObject({ code: 'N02BE01', quantity: 3 });
    });
  });

  describe('GET /api/v1/medications/critical', () => {
    it('sin ningun stock registrado responde insufficient_data', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .get('/api/v1/medications/critical')
        .set('Authorization', `Bearer ${usuario.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'insufficient_data', items: [] });
    });

    it('con stock registrado devuelve CRITICAL y LOW ordenados por dias de inventario', async () => {
      const referencia = await fechaReferencia();

      // DMT0000007: avg = 1/30, stock 0 -> 0 dias -> CRITICAL.
      await prisma.medicationStock.create({ data: { code: 'DMT0000007', quantity: 0 } });

      // Codigo sintetico con consumo grande y limpio para aterrizar en LOW
      // (3 <= dias < 7) sin depender de las cifras minusculas del fixture.
      await prisma.medication.create({ data: { code: 'ZLOW00001', name: 'Medicamento de prueba LOW', kind: 'medicamento' } });
      await prisma.medicationDispense.create({
        data: {
          id: 900_001,
          admissionId: 5001,
          code: 'ZLOW00001',
          quantity: 150,
          dispensedAt: new Date(referencia.getTime() - 5 * 24 * 60 * 60 * 1000),
          area: 'FARMACIA',
          specialty: 'MEDICINA GENERAL',
        },
      });
      await prisma.medicationStock.create({ data: { code: 'ZLOW00001', quantity: 25 } });

      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .get('/api/v1/medications/critical')
        .set('Authorization', `Bearer ${usuario.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ok');
      const items = res.body.data.items as Array<Record<string, unknown>>;

      const critico = items.find((i) => i.code === 'DMT0000007');
      expect(critico).toMatchObject({ risk: 'CRITICAL', daysOfInventory: 0 });

      const bajo = items.find((i) => i.code === 'ZLOW00001');
      expect(bajo).toMatchObject({ risk: 'LOW', daysOfInventory: 5 });

      // Orden ascendente: el mas urgente (0 dias) antes que el de 5 dias.
      expect(items.findIndex((i) => i.code === 'DMT0000007')).toBeLessThan(
        items.findIndex((i) => i.code === 'ZLOW00001'),
      );

      // Lo mismo que consume T11 desde el servicio, sin pasar por HTTP.
      const dias = await diasInventario(referencia);
      expect(dias.find((d) => d.code === 'ZLOW00001')?.daysOfInventory).toBe(5);
    });
  });

  describe('PUT /api/v1/medications/:code/stock', () => {
    it('DIRECTOR no tiene medications:manage -> 403', async () => {
      const usuario = await crearUsuarioConRol('DIRECTOR');
      const res = await api()
        .put('/api/v1/medications/B05BM002702/stock')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ quantity: 10 });
      expect(res.status).toBe(403);
    });

    it('codigo invalido responde 422', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .put('/api/v1/medications/ab/stock')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ quantity: 10 });
      expect(res.status).toBe(422);
    });

    it('cantidad negativa responde 422', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .put('/api/v1/medications/B05BM002702/stock')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ quantity: -1 });
      expect(res.status).toBe(422);
    });

    it('FARMACIA actualiza el stock: 200, auditoria y dias de inventario correctos', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .put('/api/v1/medications/B05BM002702/stock')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ quantity: 30 });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ code: 'B05BM002702', quantity: 30 });

      const rastro = await prisma.auditLog.findFirst({
        where: { action: 'medication.stock.updated' },
        orderBy: { createdAt: 'desc' },
      });
      expect(rastro?.metadata).toMatchObject({ code: 'B05BM002702', from: null, to: 30 });

      // avg = 2/30 (una unica dispensacion de 2 en el periodo de 30 dias);
      // dias = 30 / (2/30) = 450 exactos.
      const detalle = await api().get('/api/v1/medications').set('Authorization', `Bearer ${usuario.token}`);
      const manitol = (detalle.body.data as Array<Record<string, unknown>>).find((i) => i.code === 'B05BM002702');
      expect(manitol?.stock).toBe(30);
      expect(manitol?.daysOfInventory).toBe(450);
      expect(manitol?.risk).toBe('OK');
      expect(manitol?.avgDailyConsumption).toBeCloseTo(2 / 30, 3);
    });
  });
});
