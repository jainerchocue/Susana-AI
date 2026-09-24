import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { AlertSeverity, AlertStatus } from '@prisma/client';
import { prisma } from '../helpers';
import { createInternalApp } from '../../src/internal-app';
import { soloRedInterna } from '../../src/core/middleware/internal';
import { emitirTicket, usarTicket } from '../../src/modules/assistant/assistant.tickets';
import { construirSql, validarConsulta } from '../../src/modules/assistant/assistant.query';
import { datasetsPara } from '../../src/modules/assistant/assistant.catalog';
import { PERMISSIONS } from '../../src/core/rbac/permissions';
import { env } from '../../src/config/env';

/**
 * Seguridad de la API interna del agente: Python no tiene autoridad, asi que
 * esto es la ultima linea de defensa antes de tocar la base de datos. Se
 * ejercita `createInternalApp()` directamente (el segundo puerto), sin pasar
 * por el publico.
 */

const app = createInternalApp();
const CLAVE = env.INTERNAL_API_KEY!;
const PERMISOS_FARMACIA = [PERMISSIONS.alerts.read, PERMISSIONS.medications.read];

function pedir(cuerpo: object, clave?: string) {
  const peticion = request(app).post('/internal/agent/query');
  if (clave !== undefined) peticion.set('X-Internal-Key', clave);
  return peticion.send(cuerpo);
}

async function ticketConAlertas(): Promise<string> {
  return emitirTicket({
    userId: randomUUID(),
    permissions: PERMISOS_FARMACIA,
    requestId: randomUUID(),
    maxQueries: 10,
    maxRows: 200,
  });
}

beforeAll(async () => {
  await prisma.alert.deleteMany({});
  await prisma.alert.createMany({
    data: [
      {
        type: 'LOW_STOCK',
        severity: AlertSeverity.WARNING,
        status: AlertStatus.OPEN,
        scope: 'medication',
        scopeId: 'MED-1',
        metric: 'medication.daysOfInventory',
        value: 2,
        threshold: 7,
        message: 'Stock bajo de MED-1.',
      },
      {
        type: 'HIGH_OCCUPANCY',
        severity: AlertSeverity.CRITICAL,
        status: AlertStatus.OPEN,
        scope: 'service',
        scopeId: 'SRV-1',
        metric: 'service.occupancyPct',
        value: 99,
        threshold: 85,
        message: 'Ocupacion critica de SRV-1.',
      },
    ],
  });
});

afterAll(async () => {
  await prisma.alert.deleteMany({});
  await prisma.$disconnect();
});

describe('API interna del agente · clave y ticket', () => {
  it('sin X-Internal-Key -> 401', async () => {
    const ticket = await ticketConAlertas();
    const res = await pedir({ ticket, query: { dataset: 'alerts', metrics: [{ agg: 'count' }], limit: 10 } });
    expect(res.status).toBe(401);
  });

  it('con X-Internal-Key incorrecta -> 401', async () => {
    const ticket = await ticketConAlertas();
    const res = await pedir(
      { ticket, query: { dataset: 'alerts', metrics: [{ agg: 'count' }], limit: 10 } },
      'clave-incorrecta-0123456789abcdefghij',
    );
    expect(res.status).toBe(401);
  });

  it('ticket inexistente -> 401', async () => {
    const res = await pedir(
      { ticket: 'x'.repeat(43), query: { dataset: 'alerts', metrics: [{ agg: 'count' }], limit: 10 } },
      CLAVE,
    );
    expect(res.status).toBe(401);
  });

  it('Content-Type text/plain con cuerpo -> 415', async () => {
    const ticket = await ticketConAlertas();
    const res = await request(app)
      .post('/internal/agent/query')
      .set('X-Internal-Key', CLAVE)
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ ticket, query: { dataset: 'alerts', metrics: [{ agg: 'count' }], limit: 10 } }));
    expect(res.status).toBe(415);
  });
});

describe('API interna del agente · DSL e inyeccion', () => {
  it.each(["' OR 1=1 --", "x'; DROP TABLE users; --"])(
    'un valor malicioso viaja como parametro literal, nunca como SQL: %s',
    async (valorMalicioso) => {
      const ticket = await ticketConAlertas();
      const res = await pedir(
        {
          ticket,
          query: {
            dataset: 'alerts',
            metrics: [{ agg: 'count' }],
            // groupBy para que "sin filas que coincidan" de verdad sean 0 FILAS:
            // un COUNT(*) sin agrupar SIEMPRE devuelve una fila (con valor 0).
            groupBy: [{ field: 'scope' }],
            filters: [{ field: 'type', op: 'eq', value: valorMalicioso }],
            limit: 10,
          },
        },
        CLAVE,
      );
      expect(res.status).toBe(200);
      expect(res.body.data.rowCount).toBe(0);
      // La tabla `users` sigue intacta: la inyeccion nunca llego a ejecutarse como SQL.
      await expect(prisma.user.count()).resolves.toEqual(expect.any(Number));
    },
  );

  it('un campo con caracteres fuera del formato -> 422', async () => {
    const ticket = await ticketConAlertas();
    const res = await pedir(
      { ticket, query: { dataset: 'alerts', metrics: [{ agg: 'count', field: 'type; drop' }], limit: 10 } },
      CLAVE,
    );
    expect(res.status).toBe(422);
  });

  it('un dataset fuera del catalogo -> 422', async () => {
    const ticket = await ticketConAlertas();
    const res = await pedir({ ticket, query: { dataset: 'pg_user', metrics: [{ agg: 'count' }], limit: 10 } }, CLAVE);
    expect(res.status).toBe(422);
  });

  it('groupBy sobre una columna no expuesta en el catalogo -> 422', async () => {
    const ticket = await ticketConAlertas();
    const res = await pedir(
      {
        ticket,
        query: { dataset: 'alerts', metrics: [{ agg: 'count' }], groupBy: [{ field: 'acknowledged_by' }], limit: 10 },
      },
      CLAVE,
    );
    expect(res.status).toBe(422);
  });

  it('"contains" con "%" no devuelve todo (el comodin se escapa)', async () => {
    const ticket = await ticketConAlertas();
    const res = await pedir(
      {
        ticket,
        query: {
          dataset: 'alerts',
          metrics: [{ agg: 'count' }],
          groupBy: [{ field: 'scope' }],
          filters: [{ field: 'scope_id', op: 'contains', value: '%' }],
          limit: 10,
        },
      },
      CLAVE,
    );
    expect(res.status).toBe(200);
    // Ninguno de los scopeId sembrados contiene un '%' literal: si el comodin
    // no se hubiera escapado, esto habria devuelto filas agrupadas.
    expect(res.body.data.rowCount).toBe(0);
  });
});

describe('API interna del agente · tipos de valor y duplicados (revision de seguridad)', () => {
  it('un valor de texto sobre una MEDIDA numerica -> 422', async () => {
    const ticket = await ticketConAlertas();
    const res = await pedir(
      {
        ticket,
        query: {
          dataset: 'alerts',
          metrics: [{ agg: 'count' }],
          filters: [{ field: 'value', op: 'eq', value: 'no-es-un-numero' }],
          limit: 10,
        },
      },
      CLAVE,
    );
    expect(res.status).toBe(422);
  });

  it('un valor booleano -> 422 (el catalogo no tiene campos booleanos)', async () => {
    const ticket = await ticketConAlertas();
    const res = await pedir(
      { ticket, query: { dataset: 'alerts', metrics: [{ agg: 'count' }], filters: [{ field: 'type', op: 'eq', value: true }], limit: 10 } },
      CLAVE,
    );
    expect(res.status).toBe(422);
  });

  it('un array con tipos mezclados en "in" -> 422', async () => {
    const ticket = await ticketConAlertas();
    const res = await pedir(
      {
        ticket,
        query: {
          dataset: 'alerts',
          metrics: [{ agg: 'count' }],
          filters: [{ field: 'type', op: 'in', value: ['LOW_STOCK', 1] }],
          limit: 10,
        },
      },
      CLAVE,
    );
    expect(res.status).toBe(422);
  });

  it('filtro "gte" sobre first_seen_at con una fecha ISO -> 200 con las filas correctas', async () => {
    const ticket = await ticketConAlertas();
    const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const res = await pedir(
      {
        ticket,
        query: {
          dataset: 'alerts',
          metrics: [{ agg: 'count' }],
          groupBy: [{ field: 'scope' }],
          filters: [{ field: 'first_seen_at', op: 'gte', value: ayer }],
          limit: 10,
        },
      },
      CLAVE,
    );
    expect(res.status).toBe(200);
    // El ticket solo ve 'medication' (PERMISOS_FARMACIA no incluye services:read):
    // de las 2 alertas sembradas, solo MED-1 entra por el rowFilter. "desde ayer"
    // la incluye porque es de "ahora".
    const total = (res.body.data.rows as { count_all: number }[]).reduce((acc, f) => acc + f.count_all, 0);
    expect(total).toBe(1);
  });

  it('metricas repetidas (mismo agg y field) -> 422: sus alias chocarian', async () => {
    const ticket = await ticketConAlertas();
    const res = await pedir(
      {
        ticket,
        query: {
          dataset: 'alerts',
          metrics: [
            { agg: 'sum', field: 'value' },
            { agg: 'sum', field: 'value' },
          ],
          limit: 10,
        },
      },
      CLAVE,
    );
    expect(res.status).toBe(422);
  });

  it('campos repetidos en groupBy -> 422', async () => {
    const ticket = await ticketConAlertas();
    const res = await pedir(
      {
        ticket,
        query: { dataset: 'alerts', metrics: [{ agg: 'count' }], groupBy: [{ field: 'scope' }, { field: 'scope' }], limit: 10 },
      },
      CLAVE,
    );
    expect(res.status).toBe(422);
  });
});

describe('Tickets · el TTL no se extiende con el uso (revision de seguridad)', () => {
  it('caduca segun el instante de EMISION, no del ultimo uso', async () => {
    vi.useFakeTimers();
    try {
      const inicio = Date.now();
      const ticket = await emitirTicket({
        userId: randomUUID(),
        permissions: PERMISOS_FARMACIA,
        requestId: randomUUID(),
        maxQueries: 50,
        maxRows: 200,
      });

      // A mitad del TTL, usarlo varias veces no deberia alargar su vida.
      vi.setSystemTime(inicio + env.AGENT_TICKET_TTL_SECONDS * 500);
      await usarTicket(ticket);
      await usarTicket(ticket);

      // Mas alla del TTL ORIGINAL desde la emision: debe estar caducado, aunque
      // se haya usado hace un instante (con el bug, seguiria vivo).
      vi.setSystemTime(inicio + env.AGENT_TICKET_TTL_SECONDS * 1000 + 500);
      await expect(usarTicket(ticket)).rejects.toMatchObject({ status: 401 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SQL generado · piezas que solo se pueden verificar contra Postgres real', () => {
  it('date_trunc con grain parametrizado, ORDER BY por ordinal de metrica y "in" con = ANY(...)', async () => {
    const ticket = await ticketConAlertas();
    const res = await pedir(
      {
        ticket,
        query: {
          dataset: 'alerts',
          metrics: [{ agg: 'count' }, { agg: 'sum', field: 'value' }],
          groupBy: [{ field: 'first_seen_at', grain: 'day' }],
          filters: [{ field: 'type', op: 'in', value: ['LOW_STOCK', 'HIGH_OCCUPANCY'] }],
          orderBy: [{ ref: 'metric:0', dir: 'desc' }],
          limit: 10,
        },
      },
      CLAVE,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.columns).toEqual(['first_seen_at', 'count_all', 'sum_value']);
    expect(res.body.data.rowCount).toBeGreaterThan(0);

    // date_trunc('day', ...) trunca a medianoche UTC: si el parametro no se
    // hubiera aplicado de verdad, esto fallaria en Postgres o daria la hora original.
    const primera = res.body.data.rows[0] as { first_seen_at: string };
    expect(new Date(primera.first_seen_at).getUTCHours()).toBe(0);
  });
});

describe('construirSql', () => {
  it('nunca incrusta un valor del usuario en el texto: todo va en .values', () => {
    const permisos = new Set(PERMISOS_FARMACIA);
    const datasets = datasetsPara(permisos);
    const validada = validarConsulta(
      {
        dataset: 'alerts',
        metrics: [{ agg: 'count' }],
        groupBy: [],
        filters: [{ field: 'type', op: 'eq', value: "'; DROP TABLE users; --" }],
        orderBy: [],
        limit: 10,
      },
      datasets,
      200,
    );
    const sql = construirSql(validada, permisos);
    expect(sql.sql).not.toContain('DROP TABLE');
    expect(sql.sql).not.toContain("'; DROP");
    expect(sql.values).toContain("'; DROP TABLE users; --");
  });
});

describe('soloRedInterna', () => {
  function ejecutar(remoteAddress: string): unknown {
    let error: unknown = 'no-se-llamo-a-next';
    const req = { socket: { remoteAddress } } as unknown as Request;
    soloRedInterna(req, {} as never, ((e?: unknown) => {
      error = e ?? null;
    }) as never);
    return error;
  }

  it('bloquea una IP fuera de INTERNAL_ALLOWED_IPS', () => {
    expect(ejecutar('10.0.0.5')).toBeTruthy();
  });

  it('deja pasar 127.0.0.1 mapeada como IPv4-en-IPv6', () => {
    expect(ejecutar('::ffff:127.0.0.1')).toBeNull();
  });
});
