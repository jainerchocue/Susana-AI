import net from 'node:net';
import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../../config/env';
import { AppError } from '../http/errors';
import { ErrorCode, HttpStatus } from '../http/http-status';

/**
 * Defensas propias de la API interna del agente (segundo puerto, 127.0.0.1).
 * Dos capas independientes: red (IP) y clave compartida. Ninguna sustituye a
 * la otra: la red se puede falsificar detras de un proxy mal configurado, y
 * la clave sola no impide que cualquier host de la red la intente adivinar.
 */

function tipoDe(direccion: string): 'ipv4' | 'ipv6' {
  return net.isIPv6(direccion) ? 'ipv6' : 'ipv4';
}

/**
 * `net.BlockList` construido UNA vez desde INTERNAL_ALLOWED_IPS. Se admite IP
 * suelta (addAddress) o CIDR (addSubnet); el formato se distingue por la '/'.
 */
function construirListaPermitida(): net.BlockList {
  const lista = new net.BlockList();
  for (const entrada of env.INTERNAL_ALLOWED_IPS) {
    const [direccion, prefijo] = entrada.split('/');
    if (!direccion) continue;
    if (prefijo !== undefined) {
      lista.addSubnet(direccion, Number(prefijo), tipoDe(direccion));
    } else {
      lista.addAddress(direccion, tipoDe(direccion));
    }
  }
  return lista;
}

const listaPermitida = construirListaPermitida();

/** `::ffff:a.b.c.d` es la forma IPv4-mapeada que usa Node cuando escucha en '::'. */
function normalizarIp(direccion: string): string {
  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(direccion);
  return mapeada?.[1] ?? direccion;
}

/**
 * SOLO `req.socket.remoteAddress`: nunca `req.ip` ni `X-Forwarded-For`, que un
 * cliente puede falsificar libremente y volverian esta puerta decorativa.
 */
export const soloRedInterna: RequestHandler = (req, _res, next) => {
  const remota = req.socket.remoteAddress;
  if (!remota) {
    next(AppError.forbidden('Sin direccion de origen.'));
    return;
  }

  const ip = normalizarIp(remota);
  if (!listaPermitida.check(ip, tipoDe(ip))) {
    next(AppError.forbidden('Origen no permitido para la API interna del agente.'));
    return;
  }
  next();
};

/**
 * Compara `X-Internal-Key` contra INTERNAL_API_KEY con `timingSafeEqual`.
 * Se comparan hashes SHA-256 (longitud fija) en vez de las cadenas crudas:
 * `timingSafeEqual` lanza si los buffers tienen longitud distinta, y esa
 * excepcion en si misma filtraria si la longitud coincide o no.
 *
 * Sin INTERNAL_API_KEY el puerto interno no debería estar escuchando (ver
 * server.ts), pero si de algun modo llega una peticion, se cierra en fallo.
 */
export const requireInternalKey: RequestHandler = (req, _res, next) => {
  if (!env.INTERNAL_API_KEY) {
    next(new AppError(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.INTERNAL_ERROR, 'La API interna no esta configurada.'));
    return;
  }

  const recibida = req.get('x-internal-key');
  if (!recibida) {
    next(AppError.unauthorized('Falta X-Internal-Key.', ErrorCode.TOKEN_INVALID));
    return;
  }

  const esperado = crypto.createHash('sha256').update(env.INTERNAL_API_KEY).digest();
  const dado = crypto.createHash('sha256').update(recibida).digest();
  if (!crypto.timingSafeEqual(esperado, dado)) {
    next(AppError.unauthorized('X-Internal-Key invalida.', ErrorCode.TOKEN_INVALID));
    return;
  }
  next();
};
