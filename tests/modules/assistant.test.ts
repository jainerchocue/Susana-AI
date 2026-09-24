import http from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AlertSeverity, AlertStatus } from '@prisma/client';
import { api, crearUsuarioConRol, getApp, limpiar, prisma } from '../helpers';
import { createInternalApp } from '../../src/internal-app';
import { env } from '../../src/config/env';

/**
 * Asistente: React -> Node publico -> stub de Python (node:http) -> Node
 * interno. El stub imita a Python: recibe el catalogo LOGICO y el ticket, y
 * segun el escenario del test, llama de vuelta al puerto interno como lo
 * haria el agente real. Node nunca confia en lo que el stub "dice" que
 * obtuvo: las aserciones de datos leen `res.body.data.queries`, que es lo
 * que EJECUTO Node.
 */

const PUERTO_STUB = 18765;

interface CuerpoAsk {
  question: string;
  ticket: string;
  catalog: { dataset: string }[];
  limits: { maxQueries: number; maxRows: number };
  context: { referenceDate: string | null; dataStart: string | null; timezone: string };
}

interface RespuestaStub {
  status: number;
  body?: unknown;
  /** Para forzar un cuerpo que no es JSON valido. */
  crudo?: string;
}

let manejador: (cuerpo: CuerpoAsk) => Promise<RespuestaStub>;
let servidorPython: http.Server;
const internalApp = createInternalApp();

function llamarInterno(ticket: string, query: unknown) {
  return request(internalApp)
    .post('/internal/agent/query')
    .set('X-Internal-Key', env.INTERNAL_API_KEY!)
    .send({ ticket, query });
}

async function sembrarAlertas(): Promise<void> {
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
        type: 'LOW_STOCK',
        severity: AlertSeverity.WARNING,
        status: AlertStatus.OPEN,
        scope: 'medication',
        scopeId: 'MED-2',
        metric: 'medication.daysOfInventory',
        value: 3,
        threshold: 7,
        message: 'Stock bajo de MED-2.',
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
}

beforeAll(async () => {
  await getApp();
  await limpiar();
  await new Promise<void>((resolve) => {
    servidorPython = http.createServer((req, res) => {
      let datos = '';
      req.on('data', (chunk: Buffer) => {
        datos += chunk.toString('utf8');
      });
      req.on('end', () => {
        // No se puede `await` dentro del callback de 'end': se envuelve en una
        // IIFE async. Un fallo aqui deja la respuesta HTTP sin terminar, que es
        // exactamente el escenario "el stub no responde" de uno de los tests.
        void (async () => {
          if (req.headers['x-internal-key'] !== env.AGENT_API_KEY) {
            res.writeHead(401, { 'content-type': 'application/json' });
            res.end('{}');
            return;
          }
          const cuerpo = JSON.parse(datos || '{}') as CuerpoAsk;
          const respuesta = await manejador(cuerpo);
          res.writeHead(respuesta.status, { 'content-type': 'application/json' });
          res.end(respuesta.crudo ?? JSON.stringify(respuesta.body));
        })();
      });
    });
    servidorPython.listen(PUERTO_STUB, '127.0.0.1', resolve);
  });
});

afterAll(async () => {
  servidorPython.closeAllConnections();
  await new Promise<void>((resolve) => servidorPython.close(() => resolve()));
  await limpiar();
  await prisma.alert.deleteMany({});
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.alert.deleteMany({});
});

describe('POST /api/v1/assistant/query', () => {
  it('401 sin sesion', async () => {
    const res = await api().post('/api/v1/assistant/query').send({ question: 'Pregunta cualquiera' });
    expect(res.status).toBe(401);
  });

  it('403 con CONSULTA (no tiene assistant:use)', async () => {
    const u = await crearUsuarioConRol('CONSULTA');
    const res = await api()
      .post('/api/v1/assistant/query')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ question: 'Pregunta cualquiera' });
    expect(res.status).toBe(403);
  });

  it('422 con la pregunta vacia', async () => {
    const u = await crearUsuarioConRol('FARMACIA');
    const res = await api()
      .post('/api/v1/assistant/query')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ question: '' });
    expect(res.status).toBe(422);
  });

  it('422 con un campo desconocido (schema .strict())', async () => {
    const u = await crearUsuarioConRol('FARMACIA');
    const res = await api()
      .post('/api/v1/assistant/query')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ question: 'Pregunta valida y larga', extra: 'no deberia estar aqui' });
    expect(res.status).toBe(422);
  });

  it('flujo feliz: FARMACIA solo ve alertas de medicamento (rowFilter por scope)', async () => {
    await sembrarAlertas();
    const u = await crearUsuarioConRol('FARMACIA');

    // Sin `null`: una variable narrowed exactamente a `null` (el unico valor
    // asignado en el flujo directo del test; la reasignacion vive dentro del
    // closure `manejador`, invisible para el analisis de flujo de TS) hace que
    // `capturado?.status` deje de tipar como `Forma | null` y pase a `never`.
    let capturado: { status: number; body: { data: { rows: { count_all: number }[] } } } = {
      status: 0,
      body: { data: { rows: [] } },
    };
    manejador = async (cuerpo) => {
      // El catalogo que ve Python es LOGICO: nunca "alerts" con nombres de
      // columna reales. FARMACIA tiene medications:read (T1) y desde T10 ese
      // permiso tambien destapa el dataset "medications" (dispensaciones del
      // HIS): el catalogo de un FARMACIA crecio a dos datasets, no uno. Y
      // `medication_inventory` (derivado: dias de inventario) va con el mismo permiso.
      expect(cuerpo.catalog.map((d) => d.dataset)).toEqual(['alerts', 'medications', 'medication_inventory']);
      // El "hoy" de los datos viaja al agente (nulo si no hay HIS importado): nunca lo adivina.
      expect(cuerpo.context.timezone).toBe('America/Bogota');
      expect(cuerpo.context.referenceDate === null || !Number.isNaN(Date.parse(cuerpo.context.referenceDate))).toBe(true);
      expect(cuerpo.context.dataStart === null || !Number.isNaN(Date.parse(cuerpo.context.dataStart))).toBe(true);

      const respuesta = await llamarInterno(cuerpo.ticket, {
        dataset: 'alerts',
        metrics: [{ agg: 'count' }],
        groupBy: [{ field: 'severity' }],
        limit: 100,
      });
      capturado = respuesta;
      return { status: 200, body: { status: 'ok', answer: 'Hay 2 alertas de medicamento activas.' } };
    };

    const res = await api()
      .post('/api/v1/assistant/query')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ question: 'Cuantas alertas de medicamento hay activas?' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(capturado.status).toBe(200);

    const total = capturado.body.data.rows.reduce((acc, f) => acc + f.count_all, 0);
    // Solo las 2 alertas de medicamento: la de "service" queda fuera del rowFilter de FARMACIA.
    expect(total).toBe(2);

    // Node responde con lo que EL ejecuto, no con lo que el stub "dice".
    expect(res.body.data.queries).toHaveLength(1);
    expect(res.body.data.queries[0].rowCount).toBeGreaterThan(0);

    const fila = await prisma.auditLog.findFirst({
      where: { action: 'assistant.query', actorId: u.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(fila).toBeTruthy();
  });

  it('dataset inexistente en la llamada interna -> 422 y queda agent.internal.denied', async () => {
    await sembrarAlertas();
    const u = await crearUsuarioConRol('FARMACIA');

    manejador = async (cuerpo) => {
      const respuesta = await llamarInterno(cuerpo.ticket, {
        dataset: 'pg_user',
        metrics: [{ agg: 'count' }],
        limit: 10,
      });
      expect(respuesta.status).toBe(422);
      return { status: 200, body: { status: 'cannot_answer', answer: 'No tengo acceso a ese dataset.' } };
    };

    await api()
      .post('/api/v1/assistant/query')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ question: 'Cuentame algo de pg_user' });

    const fila = await prisma.auditLog.findFirst({
      where: { action: 'agent.internal.denied', actorId: u.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(fila).toBeTruthy();
  });

  it('cupo basico: la 3a consulta con el mismo ticket devuelve 403', async () => {
    await sembrarAlertas();
    // FARMACIA no tiene assistant:advanced -> AGENT_MAX_QUERIES_BASIC (2 por defecto).
    const u = await crearUsuarioConRol('FARMACIA');

    const estados: number[] = [];
    manejador = async (cuerpo) => {
      // Secuenciales a proposito: cada llamada consume cupo del MISMO ticket, en orden.
      for (let i = 0; i < 3; i += 1) {
        const respuesta = await llamarInterno(cuerpo.ticket, { dataset: 'alerts', metrics: [{ agg: 'count' }], limit: 10 });
        estados.push(respuesta.status);
      }
      return { status: 200, body: { status: 'ok', answer: 'listo' } };
    };

    await api()
      .post('/api/v1/assistant/query')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ question: 'Repite la consulta varias veces' });

    expect(estados).toEqual([200, 200, 403]);
  });

  it('el ticket queda revocado tras responder', async () => {
    await sembrarAlertas();
    const u = await crearUsuarioConRol('FARMACIA');

    let ticketCapturado = '';
    manejador = (cuerpo) => {
      ticketCapturado = cuerpo.ticket;
      return Promise.resolve({ status: 200, body: { status: 'ok', answer: 'listo' } });
    };

    const res = await api()
      .post('/api/v1/assistant/query')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ question: 'Pregunta cualquiera' });
    expect(res.status).toBe(200);

    const posterior = await llamarInterno(ticketCapturado, { dataset: 'alerts', metrics: [{ agg: 'count' }], limit: 10 });
    expect(posterior.status).toBe(401);
  });

  it('el stub devolviendo 500 -> 502 AGENT_ERROR', async () => {
    const u = await crearUsuarioConRol('FARMACIA');
    manejador = () => Promise.resolve({ status: 500, body: { mensaje: 'boom' } });

    const res = await api()
      .post('/api/v1/assistant/query')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ question: 'Pregunta cualquiera' });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AGENT_ERROR');
  });

  it('el stub que no responde -> 503 AGENT_UNAVAILABLE (timeout del cliente)', async () => {
    const u = await crearUsuarioConRol('FARMACIA');
    // Nunca resuelve: fuerza el AbortSignal.timeout(AGENT_TIMEOUT_MS) del cliente.
    manejador = () => new Promise<RespuestaStub>(() => {});

    const res = await api()
      .post('/api/v1/assistant/query')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ question: 'Pregunta cualquiera' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AGENT_UNAVAILABLE');
  }, 10_000);

  it('JSON invalido del stub -> 502 AGENT_ERROR', async () => {
    const u = await crearUsuarioConRol('FARMACIA');
    manejador = () => Promise.resolve({ status: 200, crudo: '{esto no es json valido' });

    const res = await api()
      .post('/api/v1/assistant/query')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ question: 'Pregunta cualquiera' });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AGENT_ERROR');
  });
});

describe('Tabla/grafica sugerida por el agente (visual)', () => {
  /** El stub ejecuta un conteo de alertas por severidad y responde con el `visual` que se le pase. */
  async function preguntarConVisual(visual: unknown) {
    await sembrarAlertas();
    const u = await crearUsuarioConRol('FARMACIA');
    manejador = async (cuerpo) => {
      await llamarInterno(cuerpo.ticket, {
        dataset: 'alerts',
        metrics: [{ agg: 'count' }],
        groupBy: [{ field: 'severity' }],
        limit: 100,
      });
      return { status: 200, body: { status: 'ok', answer: 'Hay 2 alertas de medicamento.', visual } };
    };
    return api().post('/api/v1/assistant/query').set('Authorization', `Bearer ${u.token}`).send({ question: 'Alertas por severidad' });
  }

  const valido = {
    type: 'bar',
    title: 'Alertas por severidad',
    queryIndex: 0,
    x: 'severity',
    xLabel: 'Severidad',
    columns: [{ key: 'count_all', label: 'Alertas', decimals: 0 }],
    valueLabels: { WARNING: 'advertencia' },
  };

  it('visual valido contra las columnas ejecutadas -> se devuelve tal cual', async () => {
    const res = await preguntarConVisual(valido);
    expect(res.status).toBe(200);
    expect(res.body.data.visual).toEqual(valido);
    // Los datos del grafico son los de Node, no los del agente.
    expect(res.body.data.queries[0].columns).toEqual(['severity', 'count_all']);
  });

  it('columna que Node no devolvio -> visual null, la respuesta sigue siendo 200', async () => {
    const res = await preguntarConVisual({ ...valido, columns: [{ key: 'sum_value', label: 'Inventado' }] });
    expect(res.status).toBe(200);
    expect(res.body.data.answer).toBe('Hay 2 alertas de medicamento.');
    expect(res.body.data.visual).toBeNull();
  });

  it('forma invalida (campo extra, queryIndex sin consulta, proyeccion en barras) -> visual null', async () => {
    for (const malo of [
      { ...valido, html: '<script>alert(1)</script>' },
      { ...valido, queryIndex: 3 },
      { ...valido, projection: { label: 'Proyeccion', points: [{ x: '2026-09-22', y: 1 }] } },
      { ...valido, x: undefined },
      'no es un objeto',
    ]) {
      const res = await preguntarConVisual(malo);
      expect(res.status).toBe(200);
      expect(res.body.data.visual).toBeNull();
    }
  });

  it('sin visual -> null (agentes anteriores siguen funcionando)', async () => {
    const res = await preguntarConVisual(undefined);
    expect(res.status).toBe(200);
    expect(res.body.data.visual).toBeNull();
  });
});
