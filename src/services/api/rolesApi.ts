import { requestData, requestPaginated } from './apiClient'
import type { ApiPaginatedResult } from './apiClient'
import type { PermissionCatalog, Role, RoleCreateInput, RoleListParams, RoleUpdateInput } from '@/types'

export const rolesApi = {
  list: (params?: RoleListParams): Promise<ApiPaginatedResult<Role>> =>
    requestPaginated<Role>({ method: 'GET', url: '/roles', params }),

  get: (id: string): Promise<Role> => requestData<Role>({ method: 'GET', url: `/roles/${id}` }),

  create: (input: RoleCreateInput): Promise<Role> => requestData<Role>({ method: 'POST', url: '/roles', data: input }),

  update: (id: string, input: RoleUpdateInput): Promise<Role> =>
    requestData<Role>({ method: 'PATCH', url: `/roles/${id}`, data: input }),

  updatePermissions: (id: string, permissions: string[]): Promise<Role> =>
    requestData<Role>({ method: 'PUT', url: `/roles/${id}/permissions`, data: { permissions } }),

  remove: (id: string): Promise<void> => requestData<void>({ method: 'DELETE', url: `/roles/${id}` }),

  permissionsCatalog: (): Promise<PermissionCatalog> =>
    requestData<PermissionCatalog>({ method: 'GET', url: '/permissions' }),
}
