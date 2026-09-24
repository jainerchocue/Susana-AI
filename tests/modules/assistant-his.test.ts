import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { cargarFixturesHis, prisma } from '../helpers';
import { createInternalApp } from '../../src/internal-app';
import { emitirTicket } from '../../src/modules/assistant/assistant.tickets';
import { construirSql, validarConsulta } from '../../src/modules/assistant/assistant.query';
import { datasetsPara } from '../../src/modules/assistant/assistant.catalog';
import { PERMISSIONS } from '../../src/core/rbac/permissions';
import { env } from '../../src/config/env';

/**
 * Datasets HIS del asistente (T10): `admissions`, `services`, `medications` y
 * `surgeries`, probados de punta a punta contra la API INTERNA (como haria
 * Python), sobre los mismos fixtures pequeños de `tests/fixtures/his` que usa
 * T6 (`cargarFixturesHis`). Las cifras esperadas estan calculadas a mano sobre
 * esos fixtures; `tests/modules/his-import.test.ts` verifica los mismos
 * derivados por separado (triageLevel, waitMinutes, executed...), asi que
 * aqui no se recalculan, solo se reutilizan.
 */

const app = createInternalApp();
const CLAVE = env.INTERNAL_API_KEY!;

async function ticketCon(permisos: string[]): Promise<string> {
  return emitirTicket({ userId: randomUUID(), permissions: permisos, requestId: randomUUID(), maxQueries: 20, maxRows: 200 });
}

function pedir(ticket: string, query: unknown) {
  return request(app).post('/internal/agent/query').set('X-Internal-Key', CLAVE).send({ ticket, query });
}

interface FilaResultado {
  rows: Record<string, string | number | boolean | null>[];
  rowCount: number;
}

/** Junta las filas de un `groupBy` de un solo campo en un `{ valor: metrica }`, para comparar de un tirón. */
function agrupar(filas: Record<string, string | number | boolean | null>[], campoGrupo: string, campoMetrica: string): Record<string, string | number | boolean | null> {
  const salida: Record<string, string | number | boolean | null> = {};
  for (const fila of filas) {
    const clave = String(fila[campoGrupo]);
    salida[clave] = fila[campoMetrica] ?? null;
  }
  return salida;
}

beforeAll(async () => {
  await cargarFixturesHis();
}, 60_000);

describe('Dataset "admissions" (services:read)', () => {
  it('count(*) agrupado por unit: 5 URGENCIAS, 1 PEDIATRIA', async () => {
    const ticket = await ticketCon([PERMISSIONS.services.read]);
    const res = await pedir(ticket, {
      dataset: 'admissions',
      metrics: [{ agg: 'count' }],
      groupBy: [{ field: 'unit' }],
      limit: 10,
    });
    expect(res.status).toBe(200);
    const datos = res.body.data as FilaResultado;
    expect(agrupar(datos.rows, 'unit', 'count_all')).toEqual({ URGENCIAS: 5, PEDIATRIA: 1 });
  });

  it('avg(wait_minutes) agrupado por triage_level: nivel 1=15, 2=25, 3=30 (fixtures de his-import.test.ts)', async () => {
    const ticket = await ticketCon([PERMISSIONS.services.read]);
    const res = await pedir(ticket, {
      dataset: 'admissions',
      metrics: [{ agg: 'avg', field: 'wait_minutes' }],
      groupBy: [{ field: 'triage_level' }],
      filters: [{ field: 'triage_level', op: 'in', value: [1, 2, 3] }],
      limit: 10,
    });
    expect(res.status).toBe(200);
    const datos = res.body.data as FilaResultado;
    expect(agrupar(datos.rows, 'triage_level', 'avg_wait_minutes')).toEqual({ '1': 15, '2': 25, '3': 30 });
  });

  it('max(stay_hours) y count_distinct(patient_zone): medidas y dimensiones derivadas tambien son consultables', async () => {
    const ticket = await ticketCon([PERMISSIONS.services.read]);
    const res = await pedir(ticket, {
      dataset: 'admissions',
      metrics: [{ agg: 'max', field: 'stay_hours' }, { agg: 'count_distinct', field: 'patient_zone' }],
      limit: 10,
    });
    expect(res.status).toBe(200);
    const datos = res.body.data as FilaResultado;
    expect(datos.rowCount).toBe(1);
    // Estancia mas larga de los fixtures: 5001 (3h), verificado en his-import.test.ts.
    expect(datos.rows[0]?.max_stay_hours).toBe(3);
    // patient_zone en los fixtures: Urbana (5) y Rural (1) -> 2 valores distintos.
    expect(datos.rows[0]?.count_distinct_patient_zone).toBe(2);
  });

  it('sin services:read -> "Dataset desconocido o no permitido" (422)', async () => {
    const ticket = await ticketCon([PERMISSIONS.medications.read]);
    const res = await pedir(ticket, { dataset: 'admissions', metrics: [{ agg: 'count' }], limit: 10 });
    expect(res.status).toBe(422);
  });
});

describe('Dataset "services" (services:read)', () => {
  it('sum(quantity) agrupado por code: 902210=3, 906914=1, 806104=1', async () => {
    const ticket = await ticketCon([PERMISSIONS.services.read]);
    const res = await pedir(ticket, {
      dataset: 'services',
      metrics: [{ agg: 'sum', field: 'quantity' }],
      groupBy: [{ field: 'code' }],
      limit: 10,
    });
    expect(res.status).toBe(200);
    const datos = res.body.data as FilaResultado;
    expect(agrupar(datos.rows, 'code', 'sum_quantity')).toEqual({ '902210': 3, '906914': 1, '806104': 1 });
  });

  it('count(*) agrupado por area: LABORATORIO CLINICO=4, CIRUGIA=1', async () => {
    const ticket = await ticketCon([PERMISSIONS.services.read]);
    const res = await pedir(ticket, {
      dataset: 'services',
      metrics: [{ agg: 'count' }],
      groupBy: [{ field: 'area' }],
      limit: 10,
    });
    expect(res.status).toBe(200);
    const datos = res.body.data as FilaResultado;
    expect(agrupar(datos.rows, 'area', 'count_all')).toEqual({ 'LABORATORIO CLINICO': 4, CIRUGIA: 1 });
  });
});

describe('Dataset "medications" (medications:read)', () => {
  it('sum(quantity) agrupado por code: cada codigo con su cantidad dispensada', async () => {
    const ticket = await ticketCon([PERMISSIONS.medications.read]);
    const res = await pedir(ticket, {
      dataset: 'medications',
      metrics: [{ agg: 'sum', field: 'quantity' }],
      groupBy: [{ field: 'code' }],
      limit: 10,
    });
    expect(res.status).toBe(200);
    const datos = res.body.data as FilaResultado;
    expect(agrupar(datos.rows, 'code', 'sum_quantity')).toEqual({
      B05BM002702: 2,
      DMT0000007: 1,
      DMC0000392: 1,
      N02BE01: 3,
    });
  });

  it('sin medications:read -> 422', async () => {
    const ticket = await ticketCon([PERMISSIONS.services.read]);
    const res = await pedir(ticket, { dataset: 'medications', metrics: [{ agg: 'count' }], limit: 10 });
    expect(res.status).toBe(422);
  });
});

describe('Dataset "surgeries" (surgeries:read)', () => {
  it('count(*) agrupado por executed: si=1, no=1, desconocido=1 (deduplicado)', async () => {
    const ticket = await ticketCon([PERMISSIONS.surgeries.read]);
    const res = await pedir(ticket, {
      dataset: 'surgeries',
      metrics: [{ agg: 'count' }],
      groupBy: [{ field: 'executed' }],
      limit: 10,
    });
    expect(res.status).toBe(200);
    const datos = res.body.data as FilaResultado;
    expect(agrupar(datos.rows, 'executed', 'count_all')).toEqual({ si: 1, no: 1, desconocido: 1 });
  });

  it('count_distinct(schedule_number) sobre la fila duplicada exacta: 3, no 4', async () => {
    const ticket = await ticketCon([PERMISSIONS.surgeries.read]);
    const res = await pedir(ticket, {
      dataset: 'surgeries',
      metrics: [{ agg: 'count_distinct', field: 'schedule_number' }],
      limit: 10,
    });
    expect(res.status).toBe(200);
    const datos = res.body.data as FilaResultado;
    // ProgramacionCirugia.txt trae 4 lineas, una duplicada exacta -> 3 filas
    // insertadas, cada una con un scheduleNumber distinto (00001, 00002, 00003).
    expect(datos.rows[0]?.count_distinct_schedule_number).toBe(3);
  });

  it('sin medidas en el catalogo: "sum" sobre surgeries -> 422', async () => {
    const ticket = await ticketCon([PERMISSIONS.surgeries.read]);
    const res = await pedir(ticket, {
      dataset: 'surgeries',
      metrics: [{ agg: 'sum', field: 'procedure_code' }],
      limit: 10,
    });
    expect(res.status).toBe(422);
  });
});

describe('Grain "day" en columnas timestamptz: zona horaria de Colombia', () => {
  it('SQL generado: admitted_at (timestamptz) lleva AT TIME ZONE; first_seen_at de alerts (sin zona) no', () => {
    const permisosHis = new Set([PERMISSIONS.services.read]);
    const datasetsHis = datasetsPara(permisosHis);
    const validadaHis = validarConsulta(
      {
        dataset: 'admissions',
        metrics: [{ agg: 'count' }],
        groupBy: [{ field: 'admitted_at', grain: 'day' }],
        filters: [],
        orderBy: [],
        limit: 10,
      },
      datasetsHis,
      200,
    );
    expect(construirSql(validadaHis, permisosHis).sql).toContain('AT TIME ZONE');

    // Regresion: alerts.firstSeenAt es "timestamp" SIN zona (no se parsea con
    // offset al escribirse, la escribe Prisma con `now()`). Convertirla con
    // AT TIME ZONE la reinterpretaria en vez de convertirla y desplazaria la
    // hora 5h sin querer: debe seguir intacta.
    const permisosAlertas = new Set([PERMISSIONS.alerts.read]);
    const datasetsAlertas = datasetsPara(permisosAlertas);
    const validadaAlertas = validarConsulta(
      {
        dataset: 'alerts',
        metrics: [{ agg: 'count' }],
        groupBy: [{ field: 'first_seen_at', grain: 'day' }],
        filters: [],
        orderBy: [],
        limit: 10,
      },
      datasetsAlertas,
      200,
    );
    expect(construirSql(validadaAlertas, permisosAlertas).sql).not.toContain('AT TIME ZONE');
  });

  it('contra Postgres real: un ingreso a las 23:30 hora Colombia cae en SU dia local, no en el dia UTC siguiente', async () => {
    // El ingreso 5001 de los fixtures ya cae el 1 de junio en ambas zonas (08:00
    // Colombia = 13:00 UTC, mismo dia calendario): no basta para distinguir el
    // bug. Se desplaza SOLO la copia en memoria de esta prueba a un instante
    // que SI cruza la medianoche UTC (23:30 Colombia del 1 de junio = 04:30 UTC
    // del 2 de junio) y se restaura al terminar: no se toca el fixture
    // compartido con T6/T8/T9 en disco.
    await prisma.admission.update({
      where: { id: 5001 },
      data: { admittedAt: new Date('2026-06-01T23:30:00-05:00') },
    });
    try {
      const ticket = await ticketCon([PERMISSIONS.services.read]);
      const res = await pedir(ticket, {
        dataset: 'admissions',
        metrics: [{ agg: 'count' }],
        groupBy: [{ field: 'admitted_at', grain: 'day' }],
        filters: [{ field: 'unit', op: 'eq', value: 'URGENCIAS' }],
        limit: 10,
      });
      expect(res.status).toBe(200);
      const datos = res.body.data as FilaResultado;
      const dias = datos.rows.map((f) => f.admitted_at as string);

      // Con la conversion a hora local, 5001 sigue cayendo el 1 de junio.
      expect(dias).toContain('2026-06-01T00:00:00.000Z');
      // Sin la conversion (date_trunc en UTC), esta fila caeria el 2 de junio,
      // duplicando esa fecha con el ingreso 5002 en vez de sumarse a la de 5001.
      const conteoJunio1 = datos.rows.find((f) => f.admitted_at === '2026-06-01T00:00:00.000Z')?.count_all;
      expect(conteoJunio1).toBe(1);
    } finally {
      await cargarFixturesHis();
    }
  }, 30_000);
});
