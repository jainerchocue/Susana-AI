import { requestData, requestPaginated } from './apiClient'
import type { ApiPaginatedResult } from './apiClient'
import type { AdminUser, UserCreateInput, UserListParams, UserUpdateInput } from '@/types'

export const usersApi = {
  list: (params?: UserListParams): Promise<ApiPaginatedResult<AdminUser>> =>
    requestPaginated<AdminUser>({ method: 'GET', url: '/users', params }),

  get: (id: string): Promise<AdminUser> => requestData<AdminUser>({ method: 'GET', url: `/users/${id}` }),

  create: (input: UserCreateInput): Promise<AdminUser> =>
    requestData<AdminUser>({ method: 'POST', url: '/users', data: input }),

  update: (id: string, input: UserUpdateInput): Promise<AdminUser> =>
    requestData<AdminUser>({ method: 'PATCH', url: `/users/${id}`, data: input }),

  updateRoles: (id: string, roles: string[]): Promise<AdminUser> =>
    requestData<AdminUser>({ method: 'PUT', url: `/users/${id}/roles`, data: { roles } }),

  remove: (id: string): Promise<void> => requestData<void>({ method: 'DELETE', url: `/users/${id}` }),
}
