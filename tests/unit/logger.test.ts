import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { RUTAS_REDACTADAS } from '../../src/core/logger';

/**
 * Pino real (no un mock), escribiendo a un stream en memoria: es la unica
 * forma de comprobar que `redact` realmente actua sobre la salida, en vez de
 * solo confiar en que la lista de rutas "parece correcta".
 */
function crearLoggerDePrueba(): { logger: pino.Logger; salida: () => string } {
  const trozos: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      trozos.push(chunk.toString('utf8'));
      cb();
    },
  });
  const logger = pino({ redact: { paths: RUTAS_REDACTADAS, censor: '[REDACTED]' } }, stream);
  return { logger, salida: () => trozos.join('') };
}

describe('Logger · redaccion de cabeceras sensibles', () => {
  it('redacta X-Internal-Key (puerto interno del agente)', () => {
    const { logger, salida } = crearLoggerDePrueba();
    logger.info({ req: { headers: { 'x-internal-key': 'clave-secreta-interna-0123456789' } } }, 'peticion interna');
    expect(salida()).not.toContain('clave-secreta-interna-0123456789');
    expect(salida()).toContain('[REDACTED]');
  });

  it('redacta set-auth-token (token de sesion del plugin bearer)', () => {
    const { logger, salida } = crearLoggerDePrueba();
    logger.info({ res: { headers: { 'set-auth-token': 'token-de-sesion-abcdef0123456789' } } }, 'login');
    expect(salida()).not.toContain('token-de-sesion-abcdef0123456789');
    expect(salida()).toContain('[REDACTED]');
  });

  it('sigue redactando authorization, cookie y set-cookie (no regresion)', () => {
    const { logger, salida } = crearLoggerDePrueba();
    logger.info(
      {
        req: { headers: { authorization: 'Bearer abc123', cookie: 'session_token=xyz789' } },
        res: { headers: { 'set-cookie': 'session_token=nuevo999' } },
      },
      'peticion',
    );
    const texto = salida();
    expect(texto).not.toContain('Bearer abc123');
    expect(texto).not.toContain('session_token=xyz789');
    expect(texto).not.toContain('session_token=nuevo999');
  });

  it('no redacta cabeceras inocuas (el censor no se aplica de mas)', () => {
    const { logger, salida } = crearLoggerDePrueba();
    logger.info({ req: { headers: { 'x-request-id': 'req-123', 'content-type': 'application/json' } } }, 'peticion');
    expect(salida()).toContain('req-123');
  });
});
