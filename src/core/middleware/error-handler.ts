import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../http/errors';
import { ErrorCode, HttpStatus } from '../http/http-status';
import { fail, type ApiFieldError } from '../http/api-response';
import { isProd } from '../../config/env';
import { logger } from '../logger';

/** 404 para rutas no registradas. Va antes del error handler. */
export const notFoundHandler: RequestHandler = (req, res) =>
  fail(res, HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `Ruta no encontrada: ${req.method} ${req.originalUrl}`);

function normalize(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    const details: ApiFieldError[] = error.issues.map((i) => ({
      field: i.path.map(String).join('.') || '(raiz)',
      message: i.message,
      code: i.code,
    }));
    return AppError.validation('Los datos enviados no son validos.', details);
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        const campos = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'campo';
        return AppError.conflict(`Ya existe un registro con ese ${campos}.`);
      }
      case 'P2025':
        return AppError.notFound('Registro');
      case 'P2003':
        return AppError.badRequest('Referencia invalida a otro registro.');
      case 'P2024':
        return new AppError(
          HttpStatus.SERVICE_UNAVAILABLE,
          ErrorCode.INTERNAL_ERROR,
          'La base de datos esta saturada. Reintenta en unos segundos.',
        );
      default:
        break;
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return new AppError(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.INTERNAL_ERROR, 'Base de datos no disponible.');
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return AppError.badRequest('JSON malformado en el cuerpo de la peticion.');
  }

  if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
    return AppError.badRequest('El cuerpo de la peticion excede el tamaño maximo.');
  }

  return AppError.internal();
}

/**
 * Los mensajes de Prisma incluyen fragmentos de la consulta con sus parametros,
 * que pueden arrastrar PII al log. `redact` de pino actua sobre rutas de
 * propiedades, no sobre texto libre (auditoria M-08).
 */
function sanear(mensaje: string): string {
  return mensaje
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, '[tarjeta]')
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[jwt]')
    .slice(0, 1000);
}

/**
 * Ultimo eslabon. Traduce cualquier error a la respuesta estandar.
 * Regla: los 500 nunca filtran el mensaje original al cliente.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const appError = normalize(error);
  const requestId = res.locals.requestId;

  if (appError.status >= 500) {
    logger.error(
      {
        err: {
          name: error instanceof Error ? error.name : typeof error,
          message: sanear(error instanceof Error ? error.message : String(error)),
          stack: error instanceof Error ? error.stack?.slice(0, 4000) : undefined,
        },
        requestId,
        path: req.originalUrl,
        method: req.method,
        userId: req.auth?.id,
      },
      'Error no controlado',
    );
  } else {
    logger.warn(
      { requestId, path: req.originalUrl, method: req.method, code: appError.code, userId: req.auth?.id },
      appError.message,
    );
  }

  const message =
    appError.status >= 500 && isProd
      ? 'Ocurrio un error interno. Intenta de nuevo mas tarde.'
      : appError.message;

  return fail(res, appError.status, appError.code, message, appError.details);
};
