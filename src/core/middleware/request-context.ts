import crypto from 'node:crypto';
import type { RequestHandler } from 'express';

/**
 * Asigna un id a cada request. Va en el header, en cada log y en el `meta`
 * de toda respuesta, para poder rastrear un fallo de punta a punta.
 *
 * El id que trae el cliente se acepta solo si encaja en una allowlist estricta:
 * reflejarlo tal cual permitia contaminar la correlacion de logs y falsificar
 * trazas de auditoria (auditoria M-05).
 */
const FORMATO_VALIDO = /^[A-Za-z0-9._-]{8,64}$/;

export const requestContext: RequestHandler = (req, res, next) => {
  const entrante = req.headers['x-request-id'];
  const esValido = typeof entrante === 'string' && FORMATO_VALIDO.test(entrante);

  // El id propio siempre se genera aqui: el del cliente es solo una referencia.
  const requestId = crypto.randomUUID();
  res.locals.requestId = requestId;
  if (esValido) res.locals.upstreamRequestId = entrante;

  res.setHeader('X-Request-Id', requestId);
  next();
};
