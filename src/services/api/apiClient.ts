import axios, { AxiosError, type AxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/app/store/authStore'
import type { ApiEnvelope, ApiErrorBody, ApiMeta, ApiPaginatedEnvelope, ApiPagination } from '@/types'
import { ApiRequestError } from '@/utils/errors'

const baseURL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

/**
 * Better Auth (montado en /auth/**) responde con su propia forma de error
 * ({code,message}), distinta del envelope {success,error} del resto de la API.
 */
interface BetterAuthErrorBody {
  code?: string
  message: string
}

function isBetterAuthError(body: unknown): body is BetterAuthErrorBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    'message' in body &&
    typeof (body as Record<string, unknown>).message === 'string' &&
    !('success' in body)
  )
}

export const httpClient = axios.create({
  baseURL,
  // Bearer-only a propósito: cuando el navegador SÍ adjunta la cookie de sesión de Better Auth
  // (same-site, ej. localhost:5173 -> localhost:3000) el backend aplica una verificación de
  // Origin para peticiones autenticadas por cookie en cualquier método de escritura y responde
  // 403 "Origen no permitido para esta operacion" — reproducido con curl en POST /imports,
  // DELETE /imports y PATCH /alerts. El token Bearer ya es la fuente real de autenticación en
  // toda la app, así que se omite la cookie por completo para no disparar esa verificación.
  withCredentials: false,
  timeout: 20_000,
})

httpClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

httpClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<unknown>) => {
    const status = error.response?.status
    const body = error.response?.data

    if (body && typeof body === 'object' && (body as { success?: boolean }).success === false) {
      const envelope = body as { error: ApiErrorBody }
      throw new ApiRequestError(envelope.error, status ?? 0)
    }

    if (isBetterAuthError(body)) {
      throw new ApiRequestError({ code: body.code ?? 'UNAUTHORIZED', message: body.message }, status ?? 0)
    }

    if (status === 401) {
      useAuthStore.getState().clearSession()
    }

    throw new ApiRequestError(
      { code: status === 403 ? 'FORBIDDEN' : 'SERVICE_UNAVAILABLE', message: 'No se pudo conectar con el servidor.' },
      status ?? 0,
    )
  },
)

export interface ApiResult<T> {
  data: T
  meta: ApiMeta
}

export interface ApiPaginatedResult<T> {
  data: T[]
  pagination: ApiPagination
  meta: ApiMeta
}

export async function request<T>(config: AxiosRequestConfig): Promise<ApiResult<T>> {
  const response = await httpClient.request<ApiEnvelope<T>>(config)
  const body = response.data
  if (!body.success) {
    throw new ApiRequestError(body.error, response.status)
  }
  return { data: body.data, meta: body.meta }
}

export async function requestData<T>(config: AxiosRequestConfig): Promise<T> {
  const { data } = await request<T>(config)
  return data
}

export async function requestPaginated<T>(config: AxiosRequestConfig): Promise<ApiPaginatedResult<T>> {
  const response = await httpClient.request<ApiPaginatedEnvelope<T>>(config)
  const body = response.data
  if (!body.success) {
    throw new ApiRequestError(body.error, response.status)
  }
  return { data: body.data, pagination: body.pagination, meta: body.meta }
}
