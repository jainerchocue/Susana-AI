import { requestData, requestPaginated } from './apiClient'
import type { ApiPaginatedResult } from './apiClient'
import type { SurgerySchedule, SurgeryScheduleCreateInput, SurgeryScheduleListParams, SurgeryScheduleUpdateInput } from '@/types'

export const surgerySchedulesApi = {
  list: (params?: SurgeryScheduleListParams): Promise<ApiPaginatedResult<SurgerySchedule>> =>
    requestPaginated<SurgerySchedule>({ method: 'GET', url: '/surgery-schedules', params }),

  get: (id: number): Promise<SurgerySchedule> =>
    requestData<SurgerySchedule>({ method: 'GET', url: `/surgery-schedules/${id}` }),

  create: (input: SurgeryScheduleCreateInput): Promise<SurgerySchedule> =>
    requestData<SurgerySchedule>({ method: 'POST', url: '/surgery-schedules', data: input }),

  update: (id: number, input: SurgeryScheduleUpdateInput): Promise<SurgerySchedule> =>
    requestData<SurgerySchedule>({ method: 'PATCH', url: `/surgery-schedules/${id}`, data: input }),

  remove: (id: number): Promise<void> => requestData<void>({ method: 'DELETE', url: `/surgery-schedules/${id}` }),
}
