import { ErrorCode, HttpStatus, type ErrorCodeValue } from './http-status';
import type { ApiFieldError } from './api-response';

/**
 * Unico tipo de error que los servicios pueden lanzar hacia afuera.
 * El error handler lo traduce a la respuesta estandar. Cualquier otro error
 * que llegue al handler se trata como 500 y NO se filtra al cliente.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCodeValue;
  readonly details?: ApiFieldError[];

  constructor(
    status: number,
    code: ErrorCodeValue,
    message: string,
    details?: ApiFieldError[],
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details) this.details = details;
    Error.captureStackTrace(this, AppError);
  }

  static badRequest(message: string, details?: ApiFieldError[]): AppError {
    return new AppError(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, message, details);
  }

  static validation(message: string, details: ApiFieldError[]): AppError {
    return new AppError(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_ERROR, message, details);
  }

  static unauthorized(
    message = 'No autenticado.',
    code: ErrorCodeValue = ErrorCode.UNAUTHORIZED,
  ): AppError {
    return new AppError(HttpStatus.UNAUTHORIZED, code, message);
  }

  static forbidden(
    message = 'No tienes permisos para realizar esta accion.',
    code: ErrorCodeValue = ErrorCode.FORBIDDEN,
  ): AppError {
    return new AppError(HttpStatus.FORBIDDEN, code, message);
  }

  static notFound(recurso = 'Recurso'): AppError {
    return new AppError(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${recurso} no encontrado.`);
  }

  static conflict(message: string): AppError {
    return new AppError(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message);
  }

  static internal(message = 'Error interno del servidor.'): AppError {
    return new AppError(HttpStatus.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_ERROR, message);
  }

  static unsupportedMediaType(): AppError {
    return new AppError(
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      ErrorCode.UNSUPPORTED_MEDIA_TYPE,
      'El cuerpo debe enviarse como application/json.',
    );
  }

  /** Python no responde: sin AGENT_URL, timeout o error de red. */
  static agentUnavailable(message = 'El asistente no esta disponible.'): AppError {
    return new AppError(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.AGENT_UNAVAILABLE, message);
  }

  /** Python respondio, pero con un HTTP no-2xx o un cuerpo que no pasa Zod. */
  static agentError(message = 'El asistente devolvio una respuesta no valida.'): AppError {
    return new AppError(HttpStatus.BAD_GATEWAY, ErrorCode.AGENT_ERROR, message);
  }

  /** El DSL propuesto no pasa la validacion semantica contra el catalogo. */
  static queryRejected(message: string, details?: ApiFieldError[]): AppError {
    return new AppError(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.QUERY_REJECTED, message, details);
  }

  static externalService(message: string, status: 502 | 503 | 504 = HttpStatus.BAD_GATEWAY): AppError {
    return new AppError(status, ErrorCode.EXTERNAL_SERVICE_ERROR, message);
  }
}
