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
  // Mantiene la cookie httpOnly (funciona en despliegues same-site); ver authStore para por qué
  // ADEMÁS se adjunta un bearer token: en este cross-origin dev/tunnel la cookie SameSite=Lax
  // de Better Auth no sobrevive a peticiones fetch/XHR de otro sitio.
  withCredentials: true,
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
