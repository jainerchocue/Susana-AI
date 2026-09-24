import type { ApiErrorBody, ApiErrorCode } from '@/types'

export class ApiRequestError extends Error {
  code: ApiErrorCode | string
  status: number
  details?: unknown

  constructor(body: ApiErrorBody, status: number) {
    super(body.message)
    this.name = 'ApiRequestError'
    this.code = body.code
    this.status = status
    this.details = body.details
  }
}

export function isForbiddenError(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 403 || error.code === 'FORBIDDEN')
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.code === 'UNAUTHORIZED')
}

/** Never surface raw stack traces or backend internals to the UI. */
export function getDisplayErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.message || 'Ocurrió un error al procesar la solicitud.'
  }
  return 'No se pudo completar la operación. Intente nuevamente.'
}
