export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED'

export interface AdminUser {
  id: string
  email: string
  name: string
  image: string | null
  status: UserStatus
  emailVerified: boolean
  twoFactorEnabled: boolean
  roles: string[]
  permissions: string[]
  createdAt: string
}

export interface UserListParams {
  page?: number
  limit?: number
  search?: string
  status?: UserStatus
  role?: string
}

export interface UserCreateInput {
  email: string
  password: string
  name: string
  roles?: string[]
}

export interface UserUpdateInput {
  name?: string
  image?: string | null
  status?: UserStatus
}
