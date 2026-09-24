import path from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { toNodeHandler } from 'better-auth/node';
import { env, isProd, trustProxyValue } from './config/env';
import { logger } from './core/logger';
import { auth, auditarLogout, describirAuth } from './core/auth/auth';
import { requestContext } from './core/middleware/request-context';
import { globalRateLimit, authRateLimit } from './core/middleware/rate-limit';
import { noStore, verificarOrigen, requireJson } from './core/middleware/security';
import { errorHandler, notFoundHandler } from './core/middleware/error-handler';
import { loadRoutes } from './core/router/autoload';
import { ok } from './core/http/api-response';
import healthRouter from './modules/health/health.routes';
import { construirOpenApi } from './core/openapi/openapi';
import { CSP_DOCS, paginaDocs } from './core/openapi/docs';

/**
 * Ensamblado de la app. El ORDEN de los middlewares importa y no debe
 * cambiarse a la ligera:
 *   contexto -> seguridad -> BETTER AUTH -> parseo -> health -> rate limit
 *            -> CSRF -> rutas -> 404 -> errores
 */
export async function createApp(): Promise<Express> {
  const app = express();

  // 'false' | numero de saltos | lista de CIDR. Un valor fijo miente en cuanto
  // hay CDN + balanceador encadenados y rompe el rate limit (auditoria M-14).
  app.set('trust proxy', trustProxyValue());
  app.disable('x-powered-by');
  app.set('etag', false); // sin ETag: las respuestas llevan requestId, nunca son iguales

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => res.locals.requestId,
      autoLogging: { ignore: (req) => req.url?.includes('/health') ?? false },
      customProps: (_req, res) => ({ upstreamRequestId: res.locals.upstreamRequestId }),
    }),
  );

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      // Una API JSON no ejecuta scripts: la politica mas restrictiva posible.
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
      },
      hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(
    cors({
      // credentials + origen concreto: '*' es incompatible con cookies de sesion.
      origin: env.CORS_ORIGINS.includes('*') ? true : env.CORS_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id', 'Idempotency-Replayed'],
      maxAge: 86_400,
    }),
  );

  // No comprimir respuestas que llevan secretos: mitiga BREACH (auditoria B-07).
  app.use(
    compression({
      filter: (req, res) => {
        const cc = String(res.getHeader('Cache-Control') ?? '');
        if (cc.includes('no-store')) return false;
        return compression.filter(req, res);
      },
    }),
  );

  /**
   * BETTER AUTH. Va ANTES de express.json() a proposito: su handler consume el
   * body crudo del stream y si un parser lo ha leido antes, llega vacio y todo
   * responde 400. Es el error de integracion mas comun de la libreria.
   *
   * `authRateLimit` delante: techo por IP en el borde. Los limites finos por
   * endpoint (sign-in, 2FA, reset) los aplica Better Auth en su propia config.
   *
   * `/sign-out` tiene una ruta especifica, registrada ANTES del comodin, para
   * intercalar `auditarLogout`: hoy el logout no se auditaba, y no puede
   * hacerse dentro de un hook de Better Auth (ver el comentario en auth.ts).
   */
  app.post(`${env.API_PREFIX}/auth/sign-out`, noStore, authRateLimit, auditarLogout, toNodeHandler(auth));
  app.all(`${env.API_PREFIX}/auth/*splat`, noStore, authRateLimit, toNodeHandler(auth));

  // Un Content-Type que no sea JSON en un body no debe colarse silenciosamente
  // hasta el handler: mejor un 415 claro aqui que un `undefined` confuso alli.
  app.use(requireJson);
  // Limite de tamaño: sin el, un body gigante puede tumbar el proceso.
  app.use(express.json({ limit: env.BODY_LIMIT, strict: true }));
  app.use(cookieParser());

  // Health va ANTES del rate limit: todas las probes llegan desde la misma IP
  // del nodo, y un 429 en el liveness reinicia el contenedor en bucle justo
  // cuando mas carga hay (auditoria A-03).
  app.use(`${env.API_PREFIX}/health`, healthRouter);

  app.use(env.API_PREFIX, globalRateLimit);

  /**
   * CSRF para el resto de la API. Con sesiones en cookie, cualquier ruta que
   * cambie estado es un objetivo, no solo las de auth: se aplica una vez aqui
   * en lugar de ruta por ruta, donde se olvidaria.
   */
  app.use(env.API_PREFIX, verificarOrigen);

  // Carga automatica: todo *.routes.ts bajo src/modules se monta solo.
  const routes = await loadRoutes(app, {
    modulesDir: path.join(__dirname, 'modules'),
    prefix: env.API_PREFIX,
    // health ya esta montado a mano, fuera del rate limit.
    exclude: ['health'],
  });

  const rutas = [
    ...routes.map((r) => r.basePath),
    `${env.API_PREFIX}/health`,
    `${env.API_PREFIX}/auth/*`,
  ].sort();

  app.get(env.API_PREFIX, (_req, res) =>
    ok(res, { name: 'hospital-intelligence-backend', environment: env.NODE_ENV, endpoints: rutas }),
  );

  // Contrato OpenAPI derivado de los mismos schemas de Zod que validan: no
  // puede desincronizarse del codigo (auditoria M-09). Async: fusiona el
  // esquema de Better Auth, que se genera con una llamada de servidor.
  app.get(`${env.API_PREFIX}/openapi.json`, async (_req, res) => res.json(await construirOpenApi()));

  /**
   * `GET {API_PREFIX}/docs`: Scalar sobre `openapi.json`. Apagable con
   * `DOCS_ENABLED=false` (produccion, por defecto). CSP propia SOLO para esta
   * ruta: se fija aqui, en la respuesta, DESPUES de que `helmet` ya puso la
   * suya (`default-src 'none'`) — `setHeader` sustituye el valor anterior, y
   * ninguna otra ruta pasa por aqui, asi que su CSP no cambia.
   */
  if (env.DOCS_ENABLED) {
    app.get(`${env.API_PREFIX}/docs`, (_req, res) => {
      res.setHeader('Content-Security-Policy', CSP_DOCS);
      res.type('html').send(paginaDocs());
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.info(describirAuth(), 'Better Auth montado');

  return app;
}
