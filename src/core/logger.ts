import pino from 'pino';
import { env, isProd } from '../config/env';

/**
 * Rutas redactadas de todo log. Se exportan (en vez de vivir solo dentro de
 * `pino({...})`) para que `tests/unit/logger.test.ts` construya un pino con
 * la MISMA lista y no una copia que pueda desincronizarse.
 *
 * `x-internal-key` es la clave compartida Python -> Node del puerto interno
 * del agente (`core/middleware/internal.ts`): pinoHttp la escribiria en claro
 * en cada peticion si no estuviera aqui. `set-auth-token` es la cabecera con
 * la que el plugin `bearer` de Better Auth devuelve el token de sesion en
 * cada login: la misma fuga que `set-cookie`, por la otra via de transporte.
 */
export const RUTAS_REDACTADAS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-key"]',
  'res.headers["set-cookie"]',
  'res.headers["set-auth-token"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  // En produccion: JSON plano para el agregador. En dev: legible.
  transport: isProd ? undefined : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  redact: {
    paths: RUTAS_REDACTADAS,
    censor: '[REDACTED]',
  },
});
