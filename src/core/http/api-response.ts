import type { Response } from 'express';
import { HttpStatus, type ErrorCodeValue } from './http-status';
import { PAGINATION } from '../../config/constants';

/**
 * CONTRATO DE RESPUESTA. Toda respuesta de la API tiene esta forma, sin
 * excepciones. No devolver objetos crudos con res.json().
 */

export interface ResponseMeta {
  requestId: string;
  timestamp: string;
}

export interface PaginationMeta {
  limit: number;
  hasNext: boolean;
  /** Cursor de la siguiente pagina. null = no hay mas. */
  nextCursor: string | null;
  /** Solo en modo pagina (paneles internos). Ausente en modo cursor: contar
   *  millones de filas en cada peticion es lo que hunde el listado. */
  page?: number;
  total?: number;
  totalPages?: number;
  hasPrev?: boolean;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export interface ApiPaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: PaginationMeta;
  meta: ResponseMeta;
}

export interface ApiFieldError {
  field: string;
  message: string;
  code?: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: ErrorCodeValue;
    message: string;
    /** Errores campo a campo. Solo presente en fallos de validacion. */
    details?: ApiFieldError[];
  };
  meta: ResponseMeta;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

function buildMeta(res: Response): ResponseMeta {
  return {
    requestId: res.locals.requestId ?? 'unknown',
    timestamp: new Date().toISOString(),
  };
}

export function ok<T>(res: Response, data: T, status: number = HttpStatus.OK): Response {
  const body: ApiSuccessResponse<T> = { success: true, data, meta: buildMeta(res) };
  return res.status(status).json(body);
}

export function created<T>(res: Response, data: T): Response {
  return ok(res, data, HttpStatus.CREATED);
}

export function noContent(res: Response): Response {
  return res.status(HttpStatus.NO_CONTENT).send();
}

export interface PaginateInput<T> {
  items: T[];
  limit?: number;
  hasNext?: boolean;
  nextCursor?: string | null;
  /** Solo si el llamador calculo el total (modo pagina). */
  total?: number;
  page?: number;
}

export function paginated<T>(res: Response, input: PaginateInput<T>): Response {
  const limit = input.limit ?? PAGINATION.defaultLimit;
  const pagination: PaginationMeta = {
    limit,
    hasNext: input.hasNext ?? false,
    nextCursor: input.nextCursor ?? null,
  };

  if (typeof input.total === 'number') {
    const totalPages = limit > 0 ? Math.ceil(input.total / limit) : 0;
    const page = input.page ?? PAGINATION.defaultPage;
    pagination.total = input.total;
    pagination.page = page;
    pagination.totalPages = totalPages;
    pagination.hasNext = page < totalPages;
    pagination.hasPrev = page > 1;
  }

  const body: ApiPaginatedResponse<T> = {
    success: true,
    data: input.items,
    pagination,
    meta: buildMeta(res),
  };
  return res.status(HttpStatus.OK).json(body);
}

export function fail(
  res: Response,
  status: number,
  code: ErrorCodeValue,
  message: string,
  details?: ApiFieldError[],
  /** Campos adicionales al mismo nivel que `error` (p. ej. checks de health). */
  extra?: Record<string, unknown>,
): Response {
  const body: ApiErrorResponse = {
    success: false,
    error: details?.length ? { code, message, details } : { code, message },
    meta: buildMeta(res),
  };
  return res.status(status).json(extra ? { ...body, ...extra } : body);
}
