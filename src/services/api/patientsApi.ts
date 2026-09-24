import { requestData, requestPaginated } from './apiClient'
import type { ApiPaginatedResult } from './apiClient'
import type { Patient, PatientCreateInput, PatientListParams, PatientUpdateInput } from '@/types'

export const patientsApi = {
  list: (params?: PatientListParams): Promise<ApiPaginatedResult<Patient>> =>
    requestPaginated<Patient>({ method: 'GET', url: '/patients', params }),

  get: (id: number): Promise<Patient> => requestData<Patient>({ method: 'GET', url: `/patients/${id}` }),

  create: (input: PatientCreateInput): Promise<Patient> =>
    requestData<Patient>({ method: 'POST', url: '/patients', data: input }),

  update: (id: number, input: PatientUpdateInput): Promise<Patient> =>
    requestData<Patient>({ method: 'PATCH', url: `/patients/${id}`, data: input }),

  remove: (id: number): Promise<void> => requestData<void>({ method: 'DELETE', url: `/patients/${id}` }),
}
