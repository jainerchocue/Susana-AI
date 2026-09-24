import { requestData, requestPaginated } from './apiClient'
import type { ApiPaginatedResult } from './apiClient'
import type { Triage, TriageCreateInput, TriageListParams, TriageUpdateInput } from '@/types'

export const triagesApi = {
  list: (params?: TriageListParams): Promise<ApiPaginatedResult<Triage>> =>
    requestPaginated<Triage>({ method: 'GET', url: '/triages', params }),

  get: (id: number): Promise<Triage> => requestData<Triage>({ method: 'GET', url: `/triages/${id}` }),

  create: (input: TriageCreateInput): Promise<Triage> =>
    requestData<Triage>({ method: 'POST', url: '/triages', data: input }),

  update: (id: number, input: TriageUpdateInput): Promise<Triage> =>
    requestData<Triage>({ method: 'PATCH', url: `/triages/${id}`, data: input }),

  remove: (id: number): Promise<void> => requestData<void>({ method: 'DELETE', url: `/triages/${id}` }),
}
