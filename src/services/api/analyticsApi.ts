import axios from 'axios'
import { httpClient, requestData } from './apiClient'
import { downloadBlob } from '@/utils/download'
import { ApiRequestError } from '@/utils/errors'
import type { AnalyticsServices, AnalyticsSurgeries, AnalyticsTriage, DateRangeParams } from '@/types'

async function downloadExport(path: string, filename: string, params?: DateRangeParams): Promise<void> {
  try {
    const response = await httpClient.get(path, { params, responseType: 'blob' })
    downloadBlob(response.data, filename)
  } catch (error) {
    throw await parseBlobError(error)
  }
}

/**
 * Los export devuelven CSV directo (Content-Type: text/csv). Se bajan por el
 * httpClient porque un <a href> no adjunta el Authorization Bearer (la cookie
 * SameSite=Lax no cruza al origen del API). Con responseType 'blob' el
 * interceptor no deserializa el cuerpo del error, así que lo intentamos aquí.
 */
async function parseBlobError(error: unknown): Promise<unknown> {
  if (!axios.isAxiosError(error)) return error

  const data = error.response?.data
  if (data instanceof Blob && data.type.includes('json')) {
    try {
      const parsed = JSON.parse(await data.text()) as { error?: { code?: string; message?: string } }
      if (parsed.error) {
        return new ApiRequestError(
          {
            code: parsed.error.code ?? 'SERVICE_UNAVAILABLE',
            message: parsed.error.message ?? 'No se pudo exportar.',
          },
          error.response?.status ?? 0,
        )
      }
    } catch {
      // cuerpo no JSON — se deja pasar el error original
    }
  }
  return error
}

export const analyticsApi = {
  getServices: (params?: DateRangeParams) =>
    requestData<AnalyticsServices>({ method: 'GET', url: '/analytics/services', params }),

  getTriage: (params?: DateRangeParams) =>
    requestData<AnalyticsTriage>({ method: 'GET', url: '/analytics/triage', params }),

  /** Sin período: el HIS no trae fecha de cirugía (ver api.md). */
  getSurgeries: () => requestData<AnalyticsSurgeries>({ method: 'GET', url: '/analytics/surgeries' }),

  downloadServices: (params?: DateRangeParams) => downloadExport('/analytics/services/export', 'analitica-servicios.csv', params),
  downloadTriage: (params?: DateRangeParams) => downloadExport('/analytics/triage/export', 'analitica-triage.csv', params),
  downloadSurgeries: () => downloadExport('/analytics/surgeries/export', 'analitica-cirugias.csv'),
}