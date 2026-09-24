#!/usr/bin/env node
/**
 * Agente Python SIMULADO, solo para desarrollo local. Implementa el contrato
 * de `docs/agent-integration.md` con lo minimo indispensable: no decide nada
 * de verdad, solo elige una consulta del DSL por palabras clave de la
 * pregunta y se la propone al puerto interno de Node, que es quien la valida
 * y la ejecuta. Sin dependencias (`node:http`, `fetch` nativo): Node >=22.
 *
 * No se usa en los tests automatizados (esos usan su propio stub de
 * `node:http` en cada archivo, ver tests/modules/assistant.test.ts): esto es
 * para probar el flujo de punta a punta con `npm run dev` en otra terminal.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const PUERTO = Number(process.env.AGENT_MOCK_PORT ?? 8000);
const AGENT_API_KEY = process.env.AGENT_API_KEY;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
const INTERNAL_HOST = process.env.INTERNAL_HOST ?? '127.0.0.1';
const INTERNAL_PORT = Number(process.env.INTERNAL_PORT ?? 3001);

if (!AGENT_API_KEY || !INTERNAL_API_KEY) {
  process.stderr.write(
    'Faltan AGENT_API_KEY o INTERNAL_API_KEY en el entorno (.env): el mock no puede validar ni llamar a Node.\n',
  );
  process.exit(1);
}

/** Quita tildes para que "cirugía"/"cirugia" o "medicamento"/"Medicamento" casen igual. */
function normalizar(texto) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Elige UNA consulta del DSL por palabras clave, solo entre los datasets que
 * vienen en el catalogo recibido (los del USUARIO que pregunto, no todos los
 * que existen): un dataset fuera de ahi seria rechazado igualmente por Node,
 * pero no tiene sentido ni proponerlo.
 */
function elegirConsulta(pregunta, catalogo) {
  const disponibles = new Set(catalogo.map((d) => d.dataset));
  const texto = normalizar(pregunta);

  if (texto.includes('medicamento') && disponibles.has('medications')) {
    return {
      dataset: 'medications',
      metrics: [{ agg: 'sum', field: 'quantity' }],
      groupBy: [{ field: 'code' }],
      orderBy: [{ ref: 'metric:0', dir: 'desc' }],
      limit: 10,
    };
  }
  if ((texto.includes('espera') || texto.includes('triage')) && disponibles.has('admissions')) {
    return {
      dataset: 'admissions',
      metrics: [{ agg: 'avg', field: 'wait_minutes' }],
      groupBy: [{ field: 'triage_level' }],
      limit: 10,
    };
  }
  if (texto.includes('cirugia') && disponibles.has('surgeries')) {
    return {
      dataset: 'surgeries',
      metrics: [{ agg: 'count' }],
      groupBy: [{ field: 'executed' }],
      limit: 10,
    };
  }
  if (disponibles.has('admissions')) {
    return { dataset: 'admissions', metrics: [{ agg: 'count' }], groupBy: [{ field: 'unit' }], limit: 10 };
  }
  return null;
}

/**
 * Llama al puerto interno de Node, tal y como lo haria el agente real (paso 3
 * del flujo). Con `node:http` en vez de `fetch`: este archivo lo lintan las
 * reglas de `scripts/**\/*.mjs` de `eslint.config.mjs` (sin tipos, con un
 * puñado de globals a mano) y `fetch` no esta entre ellos; no tiene sentido
 * tocar esa configuracion compartida por un unico script de desarrollo
 * cuando `http.request` hace exactamente lo mismo con lo que ya se importa.
 */
function llamarInterno(ticket, query) {
  return new Promise((resolve) => {
    const cuerpo = JSON.stringify({ ticket, query });
    const peticion = http.request(
      {
        hostname: INTERNAL_HOST,
        port: INTERNAL_PORT,
        path: '/internal/agent/query',
        method: 'POST',
        // Sin `content-length` a proposito: sin el, Node envia
        // `Transfer-Encoding: chunked`, que `requireJson` (core/middleware/
        // security.ts) acepta igual como "hay cuerpo". Calcularlo a mano
        // pediria `Buffer`, que no esta entre los globals que declara
        // `eslint.config.mjs` para `scripts/**/*.mjs` (solo console/process).
        headers: {
          'content-type': 'application/json',
          'x-internal-key': INTERNAL_API_KEY,
        },
      },
      (respuesta) => {
        let datos = '';
        respuesta.on('data', (trozo) => {
          datos += trozo.toString('utf8');
        });
        respuesta.on('end', () => {
          const status = respuesta.statusCode ?? 500;
          if (status < 200 || status >= 300) {
            resolve(null);
            return;
          }
          try {
            // El contrato de respuesta (CLAUDE.md §3) envuelve todo en
            // { success, data, meta }: lo que interesa aqui es `data`
            // (el ResultadoConsulta), no el sobre completo.
            const cuerpo = JSON.parse(datos);
            resolve(cuerpo.success ? cuerpo.data : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    peticion.on('error', () => resolve(null));
    peticion.write(cuerpo);
    peticion.end();
  });
}

/** Texto plantilla, no un LLM de verdad: solo enumera las primeras filas que Node ejecuto. */
function redactarRespuesta(query, resultado) {
  if (resultado.rowCount === 0) return `No encontre filas en "${query.dataset}" para responder eso.`;
  const filas = resultado.rows
    .slice(0, 5)
    .map((fila) => Object.entries(fila).map(([campo, valor]) => `${campo}=${String(valor)}`).join(', '))
    .join(' | ');
  return `Segun "${query.dataset}" (${resultado.rowCount} fila(s), truncado=${resultado.truncated}): ${filas}`;
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let datos = '';
    req.on('data', (trozo) => {
      datos += trozo.toString('utf8');
    });
    req.on('end', () => resolve(datos));
    req.on('error', reject);
  });
}

function enviarJson(res, status, cuerpo) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
}

async function manejarAsk(req, res) {
  if (req.headers['x-internal-key'] !== AGENT_API_KEY) {
    enviarJson(res, 401, { error: 'clave invalida' });
    return;
  }

  let cuerpo;
  try {
    cuerpo = JSON.parse((await leerCuerpo(req)) || '{}');
  } catch {
    enviarJson(res, 400, { error: 'JSON invalido' });
    return;
  }

  const pregunta = typeof cuerpo.question === 'string' ? cuerpo.question : '';
  const ticket = typeof cuerpo.ticket === 'string' ? cuerpo.ticket : '';
  const catalogo = Array.isArray(cuerpo.catalog) ? cuerpo.catalog : [];

  const consulta = elegirConsulta(pregunta, catalogo);
  if (!consulta) {
    enviarJson(res, 200, { status: 'cannot_answer', answer: 'No tengo un dataset disponible para responder eso.' });
    return;
  }

  const resultado = await llamarInterno(ticket, consulta);
  if (!resultado) {
    enviarJson(res, 200, { status: 'cannot_answer', answer: 'No pude obtener datos del sistema para responder.' });
    return;
  }

  enviarJson(res, 200, { status: 'ok', answer: redactarRespuesta(consulta, resultado) });
}

const servidor = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    enviarJson(res, 200, { status: 'up' });
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/ask') {
    void manejarAsk(req, res);
    return;
  }
  enviarJson(res, 404, { error: 'no encontrado' });
});

servidor.listen(PUERTO, '127.0.0.1', () => {
  process.stdout.write(`Agente simulado escuchando en http://127.0.0.1:${PUERTO} (puerto interno: ${INTERNAL_HOST}:${INTERNAL_PORT})\n`);
});
