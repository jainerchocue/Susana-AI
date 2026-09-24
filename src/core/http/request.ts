import type { Request } from 'express';
import { AppError } from './errors';
import type { RequestMeta } from '../audit/audit';

/**
 * Express 5 tipa req.params como `string | string[]` (un patron puede repetir
 * el mismo nombre). Este helper estrecha a string y falla ruidosamente si no
 * lo es, en vez de esparcir casts por los controladores.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw AppError.badRequest(`Parametro de ruta "${name}" invalido.`);
  }
  return value;
}

/**
 * Lee el cuerpo YA validado por `validate()`.
 *
 * Express tipa `req.body` como `any`, lo que propaga `any` por cada
 * controlador. El estrechamiento se concentra aqui, con el contrato explicito:
 * este helper solo es correcto si la ruta paso por `validate({ body })`.
 */
export function body<T>(req: Request): T {
  return req.body as T;
}

/**
 * Lee una cookie. Los tipos de Express declaran `req.cookies` como `any`, lo
 * que contamina de `any` todo lo que la toque; el estrechamiento vive aqui.
 */
export function cookie(req: Request, nombre: string): string | undefined {
  const bolsa: unknown = req.cookies;
  if (typeof bolsa !== 'object' || bolsa === null) return undefined;
  const valor: unknown = (bolsa as Record<string, unknown>)[nombre];
  return typeof valor === 'string' ? valor : undefined;
}

/**
 * Datos de la peticion para acompañar un rastro de auditoria. Estaba
 * duplicado, con el mismo cuerpo, en los controladores de users/roles/alerts/
 * assistant: vive aqui una sola vez (B-01).
 */
export function requestMeta(req: Request): RequestMeta {
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
    requestId: req.res?.locals.requestId ?? null,
  };
}
