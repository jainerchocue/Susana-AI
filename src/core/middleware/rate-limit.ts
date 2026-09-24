import type { RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../../config/env';
import { redis } from '../cache/redis';
import { fail } from '../http/api-response';
import { ErrorCode, HttpStatus } from '../http/http-status';
import { logger } from '../logger';

/**
 * Rate limit distribuido. Con store en memoria, N replicas multiplican por N el
 * limite efectivo y cada despliegue lo resetea (auditoria A-02).
 *
 * Better Auth trae su propio limitador por endpoint para /auth/** (ver
 * `rateLimit.customRules` en core/auth/auth.ts). Lo de aqui es la capa del
 * borde: un techo por IP para toda la API, incluida la superficie de auth.
 */
function crearStore(prefijo: string): Options['store'] | undefined {
  const cliente = redis;
  if (!cliente) {
    logger.warn({ prefijo }, 'Rate limit en memoria: solo valido con UNA instancia');
    return undefined;
  }
  return new RedisStore({
    prefix: `rl:${prefijo}:`,
    sendCommand: (...args: string[]) => cliente.call(...(args as [string, ...string[]])) as Promise<never>,
  });
}

/**
 * Normaliza la IP para la clave del limite.
 *
 * IMPRESCINDIBLE con IPv6: cada cliente recibe una /128, asi que usar la IP
 * cruda da 2^64 claves distintas a quien tenga un bloque /64 y el limite deja
 * de existir. `ipKeyGenerator` agrupa por prefijo.
 */
function claveIp(req: { ip?: string; socket: { remoteAddress?: string } }): string {
  const ip = req.ip ?? req.socket.remoteAddress;
  return ip ? ipKeyGenerator(ip) : 'sin-ip';
}

function base(prefijo: string): Partial<Options> {
  return {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: crearStore(prefijo),
    // req.ip puede venir undefined (socket UNIX, proxy mal configurado). Sin
    // este fallback la libreria lanza y tumba la request en vez de limitarla.
    keyGenerator: (req) => claveIp(req),
    handler: (_req, res) =>
      fail(res, HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED, 'Demasiadas peticiones. Intenta mas tarde.'),
  };
}

/**
 * Limite general de la API.
 * `skip` excluye health: en un orquestador todas las probes llegan desde la
 * misma IP del nodo y un 429 en el liveness reinicia el contenedor en bucle
 * justo cuando mas carga hay (auditoria A-03).
 */
export const globalRateLimit = rateLimit({
  ...base('global'),
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  skip: (req) => req.path === '/health' || req.path.startsWith('/health/') || req.path === '/metrics',
});

/**
 * Techo por IP para toda la superficie de autenticacion.
 *
 * Clave: SOLO la IP. La version anterior combinaba `ip|cuenta` en una unica
 * clave, con lo que el limite aplicaba al PAR y no a cada eje: una IP contra
 * 1.000 cuentas tenia 1.000 cupos independientes y el password spraying —
 * justo lo que el limitador decia frenar— pasaba sin tocar el techo.
 */
export const authRateLimit = rateLimit({
  ...base('auth'),
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
});

/**
 * Limitador por usuario autenticado (cae a IP si no hay `req.auth`, p. ej. una
 * peticion sin sesion que aun asi llega hasta aqui). Exportado como fabrica
 * para poder testearlo con un tope pequeño sin esperar al limite real.
 *
 * ponytail: el parametro se llama `tope` y no `max` porque, por coincidencia
 * de texto, `@typescript-eslint/no-deprecated` confunde una variable local
 * llamada `max` con la opcion `max` (deprecada) de express-rate-limit y la
 * marca como error aunque aqui solo se escriba `limit`. Verificado con `tsc`
 * limpio en ambos tsconfig; renombrar el parametro evita el falso positivo
 * sin perder nada, porque es posicional (nadie lo llama por nombre).
 */
export function limitePorUsuario(prefijo: string, tope: number): RequestHandler {
  const opciones: Partial<Options> = {
    ...base(prefijo),
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: tope,
    keyGenerator: (req) => req.auth?.id ?? claveIp(req),
  };
  return rateLimit(opciones);
}

export const assistantRateLimit = limitePorUsuario('assistant', env.ASSISTANT_RATE_LIMIT_MAX);

/**
 * Limite del puerto interno del agente. Por IP: ahi no hay sesion de usuario,
 * solo la clave compartida con Python (ver `core/middleware/internal.ts`).
 */
export const internalRateLimit = rateLimit({
  ...base('internal'),
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.INTERNAL_RATE_LIMIT_MAX,
});
