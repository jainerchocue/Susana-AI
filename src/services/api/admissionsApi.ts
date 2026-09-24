import { requestData, requestPaginated } from './apiClient'
import type { ApiPaginatedResult } from './apiClient'
import type { Admission, AdmissionCreateInput, AdmissionListParams, AdmissionUpdateInput } from '@/types'

export const admissionsApi = {
  list: (params?: AdmissionListParams): Promise<ApiPaginatedResult<Admission>> =>
    requestPaginated<Admission>({ method: 'GET', url: '/admissions', params }),

  get: (id: number): Promise<Admission> => requestData<Admission>({ method: 'GET', url: `/admissions/${id}` }),

  create: (input: AdmissionCreateInput): Promise<Admission> =>
    requestData<Admission>({ method: 'POST', url: '/admissions', data: input }),

  update: (id: number, input: AdmissionUpdateInput): Promise<Admission> =>
    requestData<Admission>({ method: 'PATCH', url: `/admissions/${id}`, data: input }),

  remove: (id: number): Promise<void> => requestData<void>({ method: 'DELETE', url: `/admissions/${id}` }),
}
