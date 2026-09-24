import { requestData, requestPaginated } from './apiClient'
import type { ApiPaginatedResult } from './apiClient'
import type { ServiceRecord, ServiceRecordCreateInput, ServiceRecordListParams, ServiceRecordUpdateInput } from '@/types'

export const serviceRecordsApi = {
  list: (params?: ServiceRecordListParams): Promise<ApiPaginatedResult<ServiceRecord>> =>
    requestPaginated<ServiceRecord>({ method: 'GET', url: '/service-records', params }),

  get: (id: number): Promise<ServiceRecord> =>
    requestData<ServiceRecord>({ method: 'GET', url: `/service-records/${id}` }),

  create: (input: ServiceRecordCreateInput): Promise<ServiceRecord> =>
    requestData<ServiceRecord>({ method: 'POST', url: '/service-records', data: input }),

  update: (id: number, input: ServiceRecordUpdateInput): Promise<ServiceRecord> =>
    requestData<ServiceRecord>({ method: 'PATCH', url: `/service-records/${id}`, data: input }),

  remove: (id: number): Promise<void> => requestData<void>({ method: 'DELETE', url: `/service-records/${id}` }),
}
