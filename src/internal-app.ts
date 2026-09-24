import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './core/logger';
import { requestContext } from './core/middleware/request-context';
import { soloRedInterna, requireInternalKey } from './core/middleware/internal';
import { internalRateLimit } from './core/middleware/rate-limit';
import { requireJson } from './core/middleware/security';
import { errorHandler, notFoundHandler } from './core/middleware/error-handler';
import internalAssistantRouter from './modules/assistant/assistant.internal';

/**
 * API interna del agente: segundo puerto, pensado para escuchar SOLO en
 * 127.0.0.1 (lo decide `server.ts`, no este archivo). A proposito no pasa por
 * el autoload de `core/router` -- ese monta cualquier `*.routes.ts` en el
 * puerto PUBLICO, y esta API nunca debe poder colarse ahi: se importa a mano,
 * una unica vez, en el ensamblado de esta app separada.
 *
 * Orden de middlewares (no cambiar sin revisar el motivo de cada uno):
 *   contexto -> log -> helmet -> red permitida -> rate limit -> clave interna
 *   -> Content-Type -> parseo -> rutas -> 404 -> errores
 *
 * El rate limit va ANTES que la clave a proposito: sin el, alguien con acceso
 * a la red (pero sin la clave) podria probar claves sin limite alguno.
 */
export function createInternalApp(): Express {
  const app = express();

  app.set('trust proxy', false);
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(requestContext);
  app.use(pinoHttp({ logger, genReqId: (_req, res) => res.locals.requestId }));
  app.use(helmet());

  app.use(soloRedInterna);
  app.use(internalRateLimit);
  app.use(requireInternalKey);

  app.use(requireJson);
  app.use(express.json({ limit: '64kb' }));

  app.use('/internal/agent', internalAssistantRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
