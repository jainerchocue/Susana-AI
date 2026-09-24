import type { RequestHandler } from 'express';
import { env } from '../../config/env';
import { cache } from '../cache/redis';
import { AppError } from '../http/errors';
import { ErrorCode, HttpStatus } from '../http/http-status';

/**
 * Impide que un proxy, CDN o el navegador almacenen respuestas que contienen
 * datos de cuenta o de sesion (auditoria M-04, CWE-525, ASVS 8.2.1).
 */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
};

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);
const METODOS_CON_CUERPO = new Set(['POST', 'PUT', 'PATCH']);

/**
 * `POST {API_PREFIX}/imports/*`: la UNICA ruta que recibe un cuerpo
 * `text/csv` (el archivo subido, en crudo). En cualquier otra ruta un CSV
 * sigue siendo un 415: no se abre la puerta a toda la API por el bien de
 * un solo modulo. `startsWith` en vez de una RegExp construida con un string
 * dinamico (aunque `API_PREFIX` este validado por Zod): mas simple y sin
 * disparar el lint de "RegExp no literal".
 */
const PREFIJO_IMPORTS = `${env.API_PREFIX}/imports/`;

/**
 * Exige `application/json` cuando la peticion trae cuerpo (y `text/csv` para
 * `POST /imports/*`, ver arriba). Sin esto, un body mal declarado (text/plain,
 * form-data...) pasa de largo por `express.json()` sin parsear y el handler
 * lee `undefined` donde esperaba un objeto: en vez de un 422 claro de Zod, se
 * cuela un error confuso mas adelante.
 *
 * Va justo antes de `express.json()` en app.ts (despues del handler de Better
 * Auth, que consume su propio body crudo). `express.json()` solo parsea
 * cuerpos `application/json`: uno `text/csv` que pase de aqui llega intacto
 * (sin consumir) al stream que lee el modulo de imports.
 */
export const requireJson: RequestHandler = (req, _res, next) => {
  if (!METODOS_CON_CUERPO.has(req.method)) return next();

  const tieneCuerpo =
    Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (!tieneCuerpo) return next();

  if (req.method === 'POST' && req.path.startsWith(PREFIJO_IMPORTS)) {
    if (!req.is('text/csv')) {
      next(AppError.unsupportedMediaType('El cuerpo debe enviarse como text/csv.'));
      return;
    }
    return next();
  }

  if (!req.is('application/json')) {
    next(AppError.unsupportedMediaType());
    return;
  }
  next();
};

/**
 * Defensa CSRF por origen para peticiones autenticadas por cookie.
 *
 * Desde la migracion a Better Auth la sesion puede viajar en cookie, asi que
 * TODA ruta que cambie estado esta expuesta, no solo las dos de refresh/logout
 * de antes. SameSite=lax cubre el caso normal, pero un despliegue multi-dominio
 * obliga a SameSite=none (auditoria A-10) y ahi la unica defensa es esta.
 *
 * Cierra en fallo: si la peticion trae cookie de sesion y no trae un Origin
 * valido, se rechaza. Antes dejaba pasar la peticion sin Origin, que es
 * precisamente la forma del ataque desde un cliente no-navegador falsificado.
 *
 * Un cliente Bearer puro (movil, servicio a servicio) no manda cookies, no
 * tiene vector CSRF y no se ve afectado.
 */
export const verificarOrigen: RequestHandler = (req, _res, next) => {
  if (METODOS_SEGUROS.has(req.method)) return next();

  // Sin cookies no hay CSRF posible: el navegador no adjunta credenciales solo.
  const cookies = req.headers.cookie;
  if (!cookies || !cookies.includes('session_token')) return next();

  const origen = req.get('origin') ?? req.get('referer');
  if (!origen) {
    next(
      AppError.forbidden(
        'Falta la cabecera Origin en una peticion autenticada por cookie.',
        ErrorCode.FORBIDDEN,
      ),
    );
    return;
  }

  let host: string;
  try {
    host = new URL(origen).origin;
  } catch {
    next(AppError.forbidden('Cabecera Origin malformada.', ErrorCode.FORBIDDEN));
    return;
  }

  // '*' nunca se acepta aqui: en produccion env.ts ya lo prohibe, y en
  // desarrollo un comodin no debe abrir la puerta a CSRF.
  if (!new Set(env.CORS_ORIGINS).has(host)) {
    next(AppError.forbidden('Origen no permitido para esta operacion.', ErrorCode.FORBIDDEN));
    return;
  }
  next();
};

/**
 * Idempotencia estilo Stripe: un reintento con la misma Idempotency-Key
 * devuelve la respuesta original en vez de repetir el efecto (auditoria M-10).
 */
const IDEMPOTENCIA_TTL_S = 86_400;
const FORMATO_CLAVE = /^[A-Za-z0-9._-]{8,128}$/;

export const idempotencia: RequestHandler = async (req, res, next) => {
  const clave = req.get('idempotency-key');
  if (!clave || !['POST', 'PATCH', 'PUT'].includes(req.method)) return next();

  if (!FORMATO_CLAVE.test(clave)) {
    next(AppError.badRequest('Idempotency-Key invalida (8-128 caracteres alfanumericos).'));
    return;
  }

  const espacio = req.auth?.id ?? req.ip ?? 'anon';
  const claveCache = `idem:${espacio}:${req.method}:${req.path}:${clave}`;

  const guardada = await cache.get(claveCache);
  if (guardada) {
    const { status, body } = JSON.parse(guardada) as { status: number; body: unknown };
    res.setHeader('Idempotency-Replayed', 'true');
    res.status(status).json(body);
    return;
  }

  // Marca de "en curso": dos peticiones simultaneas con la misma clave no deben
  // ejecutarse las dos.
  const primera = await cache.setNx(`${claveCache}:lock`, '1', 60);
  if (!primera) {
    next(
      new AppError(HttpStatus.CONFLICT, ErrorCode.CONFLICT, 'Ya hay una peticion en curso con esa Idempotency-Key.'),
    );
    return;
  }

  const jsonOriginal = res.json.bind(res);
  res.json = (body: unknown) => {
    // Solo se cachean respuestas deterministas: un 5xx debe poder reintentarse.
    if (res.statusCode < 500) {
      void cache.set(claveCache, JSON.stringify({ status: res.statusCode, body }), IDEMPOTENCIA_TTL_S);
    }
    void cache.del(`${claveCache}:lock`);
    return jsonOriginal(body);
  };

  next();
};
