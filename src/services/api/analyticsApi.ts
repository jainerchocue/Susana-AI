import { httpClient, requestData } from './apiClient'
import { downloadBlob, parseBlobError } from '@/utils/download'
import type { AnalyticsServices, AnalyticsSurgeries, AnalyticsTriage, DateRangeParams } from '@/types'

/**
 * Los export devuelven CSV directo (Content-Type: text/csv). Se bajan por el
 * httpClient porque un <a href> no adjunta el Authorization Bearer (la cookie
 * SameSite=Lax no cruza al origen del API).
 */
async function downloadExport(path: string, filename: string, params?: DateRangeParams): Promise<void> {
  try {
    const response = await httpClient.get(path, { params, responseType: 'blob' })
    downloadBlob(response.data, filename)
  } catch (error) {
    throw await parseBlobError(error)
  }
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