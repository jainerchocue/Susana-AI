import { requestData, requestPaginated } from './apiClient'
import type { ApiPaginatedResult } from './apiClient'
import type { Alert, AlertEvaluationResult, AlertListParams, AlertStatus } from '@/types'

export const alertsApi = {
  list: (params?: AlertListParams): Promise<ApiPaginatedResult<Alert>> =>
    requestPaginated<Alert>({ method: 'GET', url: '/alerts', params }),

  get: (id: string) => requestData<Alert>({ method: 'GET', url: `/alerts/${id}` }),

  updateStatus: (id: string, status: Extract<AlertStatus, 'ACKNOWLEDGED' | 'RESOLVED'>) =>
    requestData<Alert>({ method: 'PATCH', url: `/alerts/${id}`, data: { status } }),

  evaluate: () => requestData<AlertEvaluationResult>({ method: 'POST', url: '/alerts/evaluate' }),
}
