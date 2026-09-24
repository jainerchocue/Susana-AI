import { requestData, requestPaginated } from './apiClient'
import type { ApiPaginatedResult } from './apiClient'
import type { Medication, MedicationListParams, MedicationsCritical, MedicationConsumption } from '@/types'

export const medicationApi = {
  list: (params?: MedicationListParams): Promise<ApiPaginatedResult<Medication>> =>
    requestPaginated<Medication>({ method: 'GET', url: '/medications', params }),

  critical: () => requestData<MedicationsCritical>({ method: 'GET', url: '/medications/critical' }),

  consumption: (params?: { desde?: string; hasta?: string; code?: string; grain?: string }) =>
    requestData<MedicationConsumption>({ method: 'GET', url: '/medications/consumption', params }),

  updateStock: (code: string, quantity: number) =>
    requestData<{ code: string; quantity: number; updatedAt: string }>({
      method: 'PUT',
      url: `/medications/${code}/stock`,
      data: { quantity },
    }),
}
