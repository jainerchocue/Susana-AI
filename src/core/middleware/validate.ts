import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodError} from 'zod';
import { type ZodTypeAny } from 'zod';
import { AppError } from '../http/errors';
import type { ApiFieldError } from '../http/api-response';

export interface RequestSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function toFieldErrors(error: ZodError, scope: keyof RequestSchemas): ApiFieldError[] {
  return error.issues.map((issue) => ({
    field: [scope, ...issue.path.map(String)].join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Valida y NORMALIZA la request. Lo que Zod devuelve reemplaza al original,
 * asi que los handlers reciben datos ya tipados y saneados (numeros
 * convertidos, strings recortados, campos extra descartados).
 *
 * Regla: ningun handler lee req.body/query/params sin pasar por aqui.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const details: ApiFieldError[] = [];

    for (const scope of ['params', 'query', 'body'] as const) {
      const schema = schemas[scope];
      if (!schema) continue;

      const result = schema.safeParse(req[scope]);
      if (!result.success) {
        details.push(...toFieldErrors(result.error, scope));
        continue;
      }

      // req.query es getter-only en Express 5: se sustituye la propiedad.
      Object.defineProperty(req, scope, {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    if (details.length > 0) {
      next(AppError.validation('Los datos enviados no son validos.', details)); return;
    }
    next();
  };
}
