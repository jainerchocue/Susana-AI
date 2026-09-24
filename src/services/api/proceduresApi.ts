import { requestData, requestPaginated } from './apiClient'
import type { ApiPaginatedResult } from './apiClient'
import type { Procedure, ProcedureCreateInput, ProcedureListParams, ProcedureUpdateInput } from '@/types'

export const proceduresApi = {
  list: (params?: ProcedureListParams): Promise<ApiPaginatedResult<Procedure>> =>
    requestPaginated<Procedure>({ method: 'GET', url: '/procedures', params }),

  get: (code: string): Promise<Procedure> => requestData<Procedure>({ method: 'GET', url: `/procedures/${code}` }),

  create: (input: ProcedureCreateInput): Promise<Procedure> =>
    requestData<Procedure>({ method: 'POST', url: '/procedures', data: input }),

  update: (code: string, input: ProcedureUpdateInput): Promise<Procedure> =>
    requestData<Procedure>({ method: 'PATCH', url: `/procedures/${code}`, data: input }),

  remove: (code: string): Promise<void> => requestData<void>({ method: 'DELETE', url: `/procedures/${code}` }),
}
