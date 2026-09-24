import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fechaReferencia } from '../../src/modules/his/his.periodo';
import { diasInventario } from '../../src/modules/medications/medications.service';
import { api, cargarFixturesHis, crearUsuarioConRol, getApp, limpiar, prisma } from '../helpers';

/**
 * Actividad maxima de un ingreso: MISMO calculo que `recalcularDerivados`
 * (his.derivados.ts) para `lastActivityAt` -- MAX entre `providedAt` de sus
 * servicios y `dispensedAt` de sus dispensaciones -- pero consultado de forma
 * INDEPENDIENTE (no reusa la funcion de produccion) para cotejar el CRUD de
 * dispensaciones (TC4) contra la BD sin asumir a mano un valor fijo: dentro de
 * este archivo, otras secciones (p. ej. /critical) insertan dispensaciones
 * sinteticas directo por Prisma sobre el mismo ingreso 5001.
 */
async function maxActividad(admissionId: number): Promise<Date | null> {
  const [servicios, dispensaciones] = await Promise.all([
    prisma.serviceRecord.aggregate({ where: { admissionId }, _max: { providedAt: true } }),
    prisma.medicationDispense.aggregate({ where: { admissionId }, _max: { dispensedAt: true } }),
  ]);
  const candidatos = [servicios._max.providedAt, dispensaciones._max.dispensedAt].filter(
    (d): d is Date => d !== null,
  );
  return candidatos.length === 0 ? null : candidatos.reduce((a, b) => (a > b ? a : b));
}

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

  // ───────────────────────────────────────────────────────────────────────────
  // TC4: detalle, catalogo, stock (listado + borrado) y dispensaciones (CRUD).
  // ───────────────────────────────────────────────────────────────────────────

  describe('GET /api/v1/medications/:code (detalle)', () => {
    it('401 sin sesion', async () => {
      const res = await api().get('/api/v1/medications/B05BM002702');
      expect(res.status).toBe(401);
    });

    it('403 para CONSULTA (no tiene medications:read)', async () => {
      const usuario = await crearUsuarioConRol('CONSULTA');
      const res = await api()
        .get('/api/v1/medications/B05BM002702')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(403);
    });

    it('404 para un codigo inexistente', async () => {
      const usuario = await crearUsuarioConRol('DIRECTOR');
      const res = await api()
        .get('/api/v1/medications/ZNOEXISTE1')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(404);
    });

    it('sin stock: consumo/dias/riesgo insufficient_data (DMC0000392, sin stock registrado)', async () => {
      const usuario = await crearUsuarioConRol('DIRECTOR');
      const res = await api()
        .get('/api/v1/medications/DMC0000392')
        .set('Authorization', `Bearer ${usuario.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        code: 'DMC0000392',
        name: 'CATETER SUCCION',
        kind: 'insumo',
        stock: null,
        stockUpdatedAt: null,
        avgDailyConsumption: 'insufficient_data',
        daysOfInventory: 'insufficient_data',
        risk: 'insufficient_data',
      });
      // La ultima dispensacion es global (sin filtro de periodo): 2026-06-04 13:30 local = 18:30 UTC.
      expect(res.body.data.lastDispensedAt).toBe(new Date('2026-06-04T18:30:00.000Z').toISOString());
    });

    it('con stock: consumo de 30 dias, dias de inventario y riesgo cotejados a mano', async () => {
      const referencia = await fechaReferencia();
      const admin = await crearUsuarioConRol('ADMIN');

      const alta = await api()
        .post('/api/v1/medications')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ code: 'ZTESTDET1', name: 'Medicamento de prueba detalle', kind: 'medicamento' });
      expect(alta.status).toBe(201);

      // Insertado directo (no via API): 60 unidades, 10 dias antes de la referencia
      // (dentro de la ventana de 30 dias) -> avg = 60/30 = 2/dia exacto.
      const dispensadaEn = new Date(referencia.getTime() - 10 * 24 * 60 * 60 * 1000);
      await prisma.medicationDispense.create({
        data: {
          id: 900_901,
          admissionId: 5001,
          code: 'ZTESTDET1',
          quantity: 60,
          dispensedAt: dispensadaEn,
          area: 'FARMACIA',
          specialty: 'MEDICINA GENERAL',
        },
      });

      const stock = await api()
        .put('/api/v1/medications/ZTESTDET1/stock')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ quantity: 6 });
      expect(stock.status).toBe(200);

      const res = await api()
        .get('/api/v1/medications/ZTESTDET1')
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      // dias = stock(6) / avg(2) = 3.0 exactos -> LOW (3 <= dias < 7, umbrales por defecto).
      expect(res.body.data).toMatchObject({
        code: 'ZTESTDET1',
        name: 'Medicamento de prueba detalle',
        kind: 'medicamento',
        stock: 6,
        consumption30d: 60,
        daysOfInventory: 3,
        risk: 'LOW',
      });
      expect(res.body.data.avgDailyConsumption).toBeCloseTo(2, 3);
      expect(res.body.data.lastDispensedAt).toBe(dispensadaEn.toISOString());
      expect(res.body.data.stockUpdatedAt).not.toBeNull();
    });
  });

  describe('Catalogo: POST/PATCH/DELETE /api/v1/medications', () => {
    it('401 sin sesion en POST', async () => {
      const res = await api().post('/api/v1/medications').send({ code: 'ZABC0001', name: 'x', kind: 'medicamento' });
      expect(res.status).toBe(401);
    });

    it('403 para DIRECTOR (no tiene medications:manage)', async () => {
      const usuario = await crearUsuarioConRol('DIRECTOR');
      const res = await api()
        .post('/api/v1/medications')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ code: 'ZABC0001', name: 'x', kind: 'medicamento' });
      expect(res.status).toBe(403);
    });

    it('422: code invalido, kind invalido o campo desconocido', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const invalidos = [
        { code: 'ab', name: 'x', kind: 'medicamento' },
        { code: 'ZABC0001', name: 'x', kind: 'otro' },
        { code: 'ZABC0001', name: 'x', kind: 'medicamento', extra: 1 },
        { code: 'ZABC0001', kind: 'medicamento' },
      ];
      for (const body of invalidos) {
        const res = await api()
          .post('/api/v1/medications')
          .set('Authorization', `Bearer ${usuario.token}`)
          .send(body);
        expect(res.status).toBe(422);
      }
    });

    it('FARMACIA crea un medicamento (medications:manage), normalizando el codigo a mayusculas', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .post('/api/v1/medications')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ code: 'ztestcat1', name: '  Catalogo de prueba  ', kind: 'insumo' });

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({ code: 'ZTESTCAT1', name: 'Catalogo de prueba', kind: 'insumo' });

      const enBd = await prisma.medication.findUnique({ where: { code: 'ZTESTCAT1' } });
      expect(enBd).toMatchObject({ name: 'Catalogo de prueba', kind: 'insumo' });

      const rastro = await prisma.auditLog.findFirst({
        where: { action: 'data.record.created', targetType: 'medication' },
        orderBy: { createdAt: 'desc' },
      });
      expect(rastro?.metadata).toMatchObject({ code: 'ZTESTCAT1' });
    });

    it('409 al repetir el mismo codigo', async () => {
      const usuario = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .post('/api/v1/medications')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ code: 'ZTESTCAT1', name: 'otro', kind: 'medicamento' });
      expect(res.status).toBe(409);
    });

    it('PATCH: 404 para un codigo inexistente', async () => {
      const usuario = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .patch('/api/v1/medications/ZNOEXISTE1')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ name: 'x' });
      expect(res.status).toBe(404);
    });

    it('PATCH: 403 para DIRECTOR', async () => {
      const usuario = await crearUsuarioConRol('DIRECTOR');
      const res = await api()
        .patch('/api/v1/medications/ZTESTCAT1')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ name: 'x' });
      expect(res.status).toBe(403);
    });

    it('PATCH: 422 con el cuerpo vacio (.strict + refine)', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .patch('/api/v1/medications/ZTESTCAT1')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({});
      expect(res.status).toBe(422);
    });

    it('FARMACIA edita nombre y tipo; auditoria registra los campos cambiados', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .patch('/api/v1/medications/ZTESTCAT1')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ name: 'Catalogo editado', kind: 'medicamento' });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ code: 'ZTESTCAT1', name: 'Catalogo editado', kind: 'medicamento' });

      const rastro = await prisma.auditLog.findFirst({
        where: { action: 'data.record.updated', targetType: 'medication' },
        orderBy: { createdAt: 'desc' },
      });
      expect(rastro?.metadata).toMatchObject({ code: 'ZTESTCAT1', cambios: ['name', 'kind'] });
    });

    it('DELETE: 404 para un codigo inexistente', async () => {
      const usuario = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .delete('/api/v1/medications/ZNOEXISTE1')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(404);
    });

    it('409 con dispensaciones Y stock; se libera borrando cada dependiente; 204 al final', async () => {
      const admin = await crearUsuarioConRol('ADMIN');

      const alta = await api()
        .post('/api/v1/medications')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ code: 'ZTESTDEL1', name: 'Medicamento para borrar', kind: 'medicamento' });
      expect(alta.status).toBe(201);

      await prisma.medicationDispense.create({
        data: {
          id: 900_900,
          admissionId: 5001,
          code: 'ZTESTDEL1',
          quantity: 2,
          dispensedAt: new Date('2026-06-01T16:30:00.000Z'),
          area: 'FARMACIA',
          specialty: 'MEDICINA GENERAL',
        },
      });
      const conStock = await api()
        .put('/api/v1/medications/ZTESTDEL1/stock')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ quantity: 10 });
      expect(conStock.status).toBe(200);

      const primerIntento = await api()
        .delete('/api/v1/medications/ZTESTDEL1')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(primerIntento.status).toBe(409);
      expect(primerIntento.body.error.message).toMatch(/dispensacion/);
      expect(primerIntento.body.error.message).toMatch(/stock/);

      const borrarStock = await api()
        .delete('/api/v1/medications/ZTESTDEL1/stock')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(borrarStock.status).toBe(204);

      const segundoIntento = await api()
        .delete('/api/v1/medications/ZTESTDEL1')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(segundoIntento.status).toBe(409);
      expect(segundoIntento.body.error.message).toMatch(/dispensacion/);
      expect(segundoIntento.body.error.message).not.toMatch(/stock/);

      await prisma.medicationDispense.delete({ where: { id: 900_900 } });

      const tercerIntento = await api()
        .delete('/api/v1/medications/ZTESTDEL1')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(tercerIntento.status).toBe(204);

      const rastro = await prisma.auditLog.findFirst({
        where: { action: 'data.record.deleted', targetType: 'medication' },
        orderBy: { createdAt: 'desc' },
      });
      expect(rastro?.metadata).toMatchObject({ code: 'ZTESTDEL1' });

      const yaNoExiste = await api()
        .get('/api/v1/medications/ZTESTDEL1')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(yaNoExiste.status).toBe(404);
    });
  });

  describe('GET /api/v1/medications/stock y DELETE /api/v1/medications/:code/stock', () => {
    it('401 sin sesion; 403 para CONSULTA', async () => {
      const sinSesion = await api().get('/api/v1/medications/stock');
      expect(sinSesion.status).toBe(401);

      const consulta = await crearUsuarioConRol('CONSULTA');
      const sinPermiso = await api().get('/api/v1/medications/stock').set('Authorization', `Bearer ${consulta.token}`);
      expect(sinPermiso.status).toBe(403);
    });

    it('lista el stock registrado con su riesgo, cotejado con la BD', async () => {
      const usuario = await crearUsuarioConRol('DIRECTOR');
      const res = await api().get('/api/v1/medications/stock').set('Authorization', `Bearer ${usuario.token}`);

      expect(res.status).toBe(200);
      const totalReal = await prisma.medicationStock.count();
      expect(res.body.pagination.total).toBe(totalReal);

      const items = res.body.data as Array<Record<string, unknown>>;
      const manitol = items.find((i) => i.code === 'B05BM002702');
      // Cargado en la seccion de PUT /:code/stock (mas arriba en este archivo): quantity=30.
      expect(manitol).toMatchObject({ code: 'B05BM002702', name: 'MANITOL SOLUCION', quantity: 30 });
    });

    it('filtra por risk, cotejado con el mismo calculo que el listado y /critical', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .get('/api/v1/medications/stock?risk=CRITICAL')
        .set('Authorization', `Bearer ${usuario.token}`);

      expect(res.status).toBe(200);
      const items = res.body.data as Array<Record<string, unknown>>;
      expect(items.every((i) => i.risk === 'CRITICAL')).toBe(true);
      // DMT0000007 quedo en CRITICAL (stock=0) en la seccion de /critical, mas arriba.
      expect(items.some((i) => i.code === 'DMT0000007')).toBe(true);
    });

    it('DELETE: 403 para DIRECTOR (no tiene medications:manage)', async () => {
      const usuario = await crearUsuarioConRol('DIRECTOR');
      const res = await api()
        .delete('/api/v1/medications/B05BM002702/stock')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(403);
    });

    it('DELETE: 404 si el codigo no tiene stock registrado', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .delete('/api/v1/medications/N02BE01/stock')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(404);
    });

    it('204 al borrar; auditoria con from=cantidad anterior; desaparece del listado y del detalle', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');

      const res = await api()
        .delete('/api/v1/medications/B05BM002702/stock')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(204);

      const rastro = await prisma.auditLog.findFirst({
        where: { action: 'medication.stock.deleted' },
        orderBy: { createdAt: 'desc' },
      });
      expect(rastro?.metadata).toMatchObject({ code: 'B05BM002702', from: 30 });

      const enBd = await prisma.medicationStock.findUnique({ where: { code: 'B05BM002702' } });
      expect(enBd).toBeNull();

      const detalle = await api()
        .get('/api/v1/medications/B05BM002702')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(detalle.body.data.stock).toBeNull();
    });
  });

  describe('Dispensaciones: CRUD completo /api/v1/medications/dispenses', () => {
    it('401 sin sesion en el listado', async () => {
      const res = await api().get('/api/v1/medications/dispenses');
      expect(res.status).toBe(401);
    });

    it('403 para CONSULTA en el listado (no tiene medications:read)', async () => {
      const usuario = await crearUsuarioConRol('CONSULTA');
      const res = await api()
        .get('/api/v1/medications/dispenses')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(403);
    });

    it('lista y filtra por admissionId, cotejado con una consulta propia a la BD', async () => {
      const usuario = await crearUsuarioConRol('DIRECTOR');
      const res = await api()
        .get('/api/v1/medications/dispenses?admissionId=5003')
        .set('Authorization', `Bearer ${usuario.token}`);

      expect(res.status).toBe(200);
      const esperadas = await prisma.medicationDispense.findMany({ where: { admissionId: 5003 } });
      expect(res.body.data).toHaveLength(esperadas.length);
      expect(res.body.data[0]).toMatchObject({ id: 2, admissionId: 5003, code: 'DMT0000007', quantity: 1 });
    });

    it('cursor: recorre TODO el listado en paginas de 2 y coincide en ids/orden con la BD', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const todasReales = await prisma.medicationDispense.findMany({ orderBy: { id: 'asc' } });

      const idsRecorridos: number[] = [];
      let cursor: number | undefined;
      for (let vueltas = 0; vueltas < 50; vueltas += 1) {
        const url = cursor
          ? `/api/v1/medications/dispenses?limit=2&cursor=${cursor}`
          : '/api/v1/medications/dispenses?limit=2';
        const res = await api().get(url).set('Authorization', `Bearer ${usuario.token}`);
        expect(res.status).toBe(200);
        const items = res.body.data as Array<{ id: number }>;
        idsRecorridos.push(...items.map((i) => i.id));
        if (!res.body.pagination.hasNext) break;
        cursor = Number(res.body.pagination.nextCursor);
      }

      expect(idsRecorridos).toEqual(todasReales.map((f) => f.id));
    });

    it('POST: 403 para FARMACIA (tiene medications:manage pero NO data:manage)', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const res = await api()
        .post('/api/v1/medications/dispenses')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({
          id: 900_200,
          admissionId: 5001,
          code: 'B05BM002702',
          quantity: 1,
          dispensedAt: '2026-06-01T12:00:00-05:00',
          area: 'FARMACIA',
          specialty: 'MEDICINA GENERAL',
        });
      expect(res.status).toBe(403);
    });

    it('POST: 422 con dispensedAt sin desfase, cantidad negativa o campo desconocido', async () => {
      const usuario = await crearUsuarioConRol('ADMIN');
      const base = {
        id: 900_201,
        admissionId: 5001,
        code: 'B05BM002702',
        quantity: 1,
        dispensedAt: '2026-06-01T12:00:00-05:00',
        area: 'FARMACIA',
        specialty: 'MEDICINA GENERAL',
      };
      const invalidos = [
        { ...base, dispensedAt: '2026-06-01T12:00:00' },
        { ...base, quantity: -1 },
        { ...base, extra: 1 },
        { ...base, id: undefined },
      ];
      for (const body of invalidos) {
        const res = await api()
          .post('/api/v1/medications/dispenses')
          .set('Authorization', `Bearer ${usuario.token}`)
          .send(body);
        expect(res.status).toBe(422);
      }
    });

    it('POST: 409 si el id ya existe', async () => {
      const usuario = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .post('/api/v1/medications/dispenses')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({
          id: 1, // ya existe en los fixtures (MANITOL, admissionId 5001)
          admissionId: 5001,
          code: 'B05BM002702',
          quantity: 1,
          dispensedAt: '2026-06-01T12:00:00-05:00',
          area: 'FARMACIA',
          specialty: 'MEDICINA GENERAL',
        });
      expect(res.status).toBe(409);
    });

    it('POST: 400 con un admissionId que no existe (FK invalida)', async () => {
      const usuario = await crearUsuarioConRol('ADMIN');
      const res = await api()
        .post('/api/v1/medications/dispenses')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({
          id: 900_202,
          admissionId: 99_999_999,
          code: 'B05BM002702',
          quantity: 1,
          dispensedAt: '2026-06-01T12:00:00-05:00',
          area: 'FARMACIA',
          specialty: 'MEDICINA GENERAL',
        });
      expect(res.status).toBe(400);
    });

    it('GET /dispenses/:id: 404 para un id inexistente', async () => {
      const usuario = await crearUsuarioConRol('DIRECTOR');
      const res = await api()
        .get('/api/v1/medications/dispenses/900999999')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(404);
    });

  describe('ciclo de vida completo (crear, editar, mover de ingreso, borrar): recalcula los ingresos', () => {
    // Compartido entre los 4 pasos (secuenciales, como el resto de este archivo,
    // p. ej. "PUT /:code/stock"): cada `it` continua el estado que dejo el anterior.
    let admin: Awaited<ReturnType<typeof crearUsuarioConRol>>;
    let maxPrevio5001: Date | null;
    const dispensedAtNuevo = new Date('2026-06-01T20:00:00.000Z'); // 2026-06-01T15:00:00-05:00 local

    it('preparacion: 5002 sin actividad previa; 5001 se mide de forma independiente (no a mano)', async () => {
      admin = await crearUsuarioConRol('ADMIN');

      // 5002 no aparece en ningun fixture HIS ni en ninguna insercion sintetica
      // de una seccion anterior de este archivo: sigue sin actividad (null).
      const antes5002 = await prisma.admission.findUniqueOrThrow({ where: { id: 5002 } });
      expect(antes5002.lastActivityAt).toBeNull();

      // La actividad PREVIA de 5001 no se asume a mano (otras secciones de este
      // archivo -p. ej. /critical- insertan dispensaciones sinteticas directo
      // por Prisma sobre el mismo ingreso, sin pasar por `recalcularDerivados`):
      // se calcula de forma independiente (`maxActividad`) y se usa como base
      // de comparacion en cada paso.
      maxPrevio5001 = await maxActividad(5001);
      expect(maxPrevio5001 === null || dispensedAtNuevo > maxPrevio5001).toBe(true);
    });

    it('1) crear: la nueva fecha es posterior a toda la actividad previa de 5001 -> pasa a ser su lastActivityAt', async () => {
      const creado = await api()
        .post('/api/v1/medications/dispenses')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          id: 900_100,
          admissionId: 5001,
          code: 'B05BM002702',
          quantity: 7,
          dispensedAt: '2026-06-01T15:00:00-05:00',
          area: 'FARMACIA',
          specialty: 'MEDICINA GENERAL',
        });
      expect(creado.status).toBe(201);
      expect(creado.body.data).toMatchObject({
        id: 900_100,
        admissionId: 5001,
        code: 'B05BM002702',
        quantity: 7,
        area: 'FARMACIA',
        specialty: 'MEDICINA GENERAL',
      });
      expect(creado.body.data.dispensedAt).toBe(dispensedAtNuevo.toISOString());

      const auditCreado = await prisma.auditLog.findFirst({
        where: { action: 'data.record.created', targetType: 'medication_dispense' },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditCreado?.metadata).toMatchObject({ id: 900_100, admissionId: 5001, code: 'B05BM002702' });

      const tras5001 = await prisma.admission.findUniqueOrThrow({ where: { id: 5001 } });
      expect(tras5001.lastActivityAt?.toISOString()).toBe(dispensedAtNuevo.toISOString());
    });

    it('2) editar solo la cantidad: no cambia el ingreso ni la fecha -> lastActivityAt no se mueve', async () => {
      const editado = await api()
        .patch('/api/v1/medications/dispenses/900100')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ quantity: 9 });
      expect(editado.status).toBe(200);
      expect(editado.body.data.quantity).toBe(9);

      const tras5001SinCambioDeIngreso = await prisma.admission.findUniqueOrThrow({ where: { id: 5001 } });
      expect(tras5001SinCambioDeIngreso.lastActivityAt?.toISOString()).toBe(dispensedAtNuevo.toISOString());
    });

    it('3) mover de ingreso (5001 -> 5002): recalcula LOS DOS', async () => {
      // 5001 vuelve a su maximo restante (el mismo que antes de crear esta
      // fila); 5002 pasa a tener esta dispensacion como su unica actividad.
      const movido = await api()
        .patch('/api/v1/medications/dispenses/900100')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ admissionId: 5002 });
      expect(movido.status).toBe(200);
      expect(movido.body.data.admissionId).toBe(5002);

      const auditEditado = await prisma.auditLog.findFirst({
        where: { action: 'data.record.updated', targetType: 'medication_dispense' },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditEditado?.metadata).toMatchObject({ id: 900_100 });

      const tras5001Movido = await prisma.admission.findUniqueOrThrow({ where: { id: 5001 } });
      const tras5002Movido = await prisma.admission.findUniqueOrThrow({ where: { id: 5002 } });
      expect(tras5001Movido.lastActivityAt?.toISOString() ?? null).toBe(maxPrevio5001?.toISOString() ?? null);
      expect(tras5002Movido.lastActivityAt?.toISOString()).toBe(dispensedAtNuevo.toISOString());
    });

    it('4) borrar: 5002 conserva el valor (sin fila que recalcular), 5001 no cambia; 404 despues', async () => {
      // `recalcularDerivados` (TC0/his.derivados.ts, compartido con el
      // importador: no se toca su comportamiento) es un UPDATE...FROM con JOIN
      // implicito contra la subquery de actividad: un ingreso que se queda SIN
      // ninguna fila de actividad no tiene fila que hacer match ahi, asi que su
      // lastActivityAt anterior queda TAL CUAL (no se resetea a null). 5002
      // conserva entonces el valor de la dispensacion recien borrada; 5001 no
      // cambia (ya no la referenciaba desde el paso 3).
      const borrado = await api()
        .delete('/api/v1/medications/dispenses/900100')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(borrado.status).toBe(204);

      const auditBorrado = await prisma.auditLog.findFirst({
        where: { action: 'data.record.deleted', targetType: 'medication_dispense' },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditBorrado?.metadata).toMatchObject({ id: 900_100, admissionId: 5002 });

      const final5001 = await prisma.admission.findUniqueOrThrow({ where: { id: 5001 } });
      const final5002 = await prisma.admission.findUniqueOrThrow({ where: { id: 5002 } });
      expect(final5001.lastActivityAt?.toISOString() ?? null).toBe(maxPrevio5001?.toISOString() ?? null);
      expect(final5002.lastActivityAt?.toISOString()).toBe(dispensedAtNuevo.toISOString());

      const yaNoExiste = await api()
        .get('/api/v1/medications/dispenses/900100')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(yaNoExiste.status).toBe(404);
    });
  });

    it('PATCH/DELETE: 404 para un id inexistente', async () => {
      const usuario = await crearUsuarioConRol('ADMIN');
      const patch = await api()
        .patch('/api/v1/medications/dispenses/900999998')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ quantity: 1 });
      expect(patch.status).toBe(404);

      const del = await api()
        .delete('/api/v1/medications/dispenses/900999998')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(del.status).toBe(404);
    });

    it('PATCH/DELETE: 403 para FARMACIA (no tiene data:manage)', async () => {
      const usuario = await crearUsuarioConRol('FARMACIA');
      const patch = await api()
        .patch('/api/v1/medications/dispenses/2')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ quantity: 1 });
      expect(patch.status).toBe(403);

      const del = await api()
        .delete('/api/v1/medications/dispenses/2')
        .set('Authorization', `Bearer ${usuario.token}`);
      expect(del.status).toBe(403);
    });
  });
});
