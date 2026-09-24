export interface Role {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  permissions: string[]
  usersCount: number
  createdAt: string
}

export interface RoleListParams {
  page?: number
  limit?: number
  search?: string
}

export interface RoleCreateInput {
  name: string
  description?: string
  permissions?: string[]
}

export interface RoleUpdateInput {
  name?: string
  description?: string | null
}

export interface PermissionCatalogEntry {
  id: string
  action: string
  group: string
  description: string | null
}

export interface PermissionCatalogGroup {
  group: string
  permissions: PermissionCatalogEntry[]
}

export interface PermissionCatalog {
  total: number
  groups: PermissionCatalogGroup[]
}
