import { httpClient, requestData, requestPaginated } from './apiClient'
import type { ApiPaginatedResult } from './apiClient'
import { downloadBlob, parseBlobError } from '@/utils/download'
import type { ImportJob, ImportListParams, ImportTable } from '@/types'

const TABLE_TEMPLATE_FILENAMES: Record<ImportTable, string> = {
  patients: 'plantilla-pacientes.csv',
  admissions: 'plantilla-ingresos.csv',
  triages: 'plantilla-triages.csv',
  'first-care': 'plantilla-primera-atencion.csv',
  'service-records': 'plantilla-servicios.csv',
  dispenses: 'plantilla-dispensaciones.csv',
  'surgery-schedules': 'plantilla-cirugias.csv',
}

export const importsApi = {
  list: (params?: ImportListParams): Promise<ApiPaginatedResult<ImportJob>> =>
    requestPaginated<ImportJob>({ method: 'GET', url: '/imports', params }),

  get: (id: string): Promise<ImportJob> => requestData<ImportJob>({ method: 'GET', url: `/imports/${id}` }),

  /**
   * El cuerpo de la petición ES el archivo (text/csv crudo, no multipart). El
   * 202 solo confirma la creación del job — el timeout se extiende porque el
   * archivo completo viaja en esta llamada aunque el procesamiento sea async.
   */
  upload: (table: ImportTable, file: File): Promise<ImportJob> =>
    requestData<ImportJob>({
      method: 'POST',
      url: `/imports/${table}`,
      data: file,
      headers: { 'Content-Type': 'text/csv' },
      params: { fileName: file.name },
      timeout: 120_000,
    }),

  downloadTemplate: async (table: ImportTable): Promise<void> => {
    try {
      const response = await httpClient.get(`/imports/templates/${table}`, { responseType: 'blob' })
      downloadBlob(response.data, TABLE_TEMPLATE_FILENAMES[table])
    } catch (error) {
      throw await parseBlobError(error)
    }
  },

  remove: (id: string): Promise<void> => requestData<void>({ method: 'DELETE', url: `/imports/${id}` }),
}
