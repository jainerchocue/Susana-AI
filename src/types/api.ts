/** Envelope real del backend (core/http/api-response.ts). */
export interface ApiSuccess<T> {
  success: true
  data: T
  meta: ApiMeta
}

export interface ApiPaginatedSuccess<T> {
  success: true
  data: T[]
  pagination: ApiPagination
  meta: ApiMeta
}

export interface ApiFailure {
  success: false
  error: ApiErrorBody
  meta: ApiMeta
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure
export type ApiPaginatedEnvelope<T> = ApiPaginatedSuccess<T> | ApiFailure

export interface ApiMeta {
  requestId?: string
  timestamp?: string
}

/** Cursor-based (alerts, audit) y page-based (roles, medications) comparten esta forma. */
export interface ApiPagination {
  limit: number
  hasNext: boolean
  nextCursor: string | null
  total?: number
  page?: number
  totalPages?: number
  hasPrev?: boolean
}

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'TOKEN_INVALID'
  | 'FORBIDDEN'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'ACCOUNT_SUSPENDED'
  | 'EMAIL_NOT_VERIFIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'QUERY_REJECTED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'AGENT_ERROR'
  | 'AGENT_UNAVAILABLE'
  | 'EXTERNAL_SERVICE_ERROR'

export interface ApiErrorDetail {
  field: string
  message: string
  code?: string
}

export interface ApiErrorBody {
  code: ApiErrorCode | string
  message: string
  details?: ApiErrorDetail[]
}

/** `desde`/`hasta` ISO 8601 — así los espera el backend en query params. */
export interface DateRangeParams {
  desde?: string
  hasta?: string
}
