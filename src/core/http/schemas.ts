import { z } from 'zod';
import { PAGINATION } from '../../config/constants';

/**
 * Piezas de validacion compartidas. Evita que cada modulo reinvente el email
 * o la URL y que uno de ellos se olvide de una restriccion.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Correo invalido.')
  .max(254);

export const uuidSchema = z.string().uuid('Identificador invalido.');

export const idParamSchema = z.object({ id: uuidSchema });

/**
 * z.string().url() acepta CUALQUIER esquema, incluido `javascript:` y `data:`.
 * Guardar uno y servirlo al frontend es XSS almacenado (auditoria M-03).
 * Ademas se bloquean direcciones internas por si algun dia el backend las descarga.
 */
export const urlSegura = z
  .string()
  .trim()
  .max(2048)
  .superRefine((valor, ctx) => {
    let url: URL;
    try {
      url = new URL(valor);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'URL invalida.' });
      return;
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      ctx.addIssue({ code: 'custom', message: 'Solo se permiten URLs http o https.' });
    }

    const host = url.hostname.toLowerCase();
    const esInterna =
      host === 'localhost' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);

    if (esInterna) {
      ctx.addIssue({ code: 'custom', message: 'No se permiten direcciones internas.' });
    }
  });

/**
 * Paginacion por cursor (keyset): coste constante con la profundidad, frente
 * al OFFSET que obliga a leer y descartar todo lo anterior (auditoria A-13).
 * Se mantiene `page` para paneles internos con pocas paginas.
 */
export const cursorQuerySchema = z.object({
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
});

export const offsetQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(PAGINATION.defaultPage),
  limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
});

/** Texto libre de busqueda: acotado para no disparar consultas absurdas. */
export const searchSchema = z.string().trim().min(2).max(120);
