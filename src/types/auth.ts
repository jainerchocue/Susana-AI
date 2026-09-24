/**
 * Los roles son dinámicos (administrables vía POST /roles), por lo que no hay
 * un enum cerrado — el backend es la única fuente de verdad sobre qué roles existen.
 */
export type RoleCode = string

/** Los permisos también son datos del backend (GET /permissions); ver @/constants/permissions para los que usa esta UI. */
export type Permission = string

export interface AuthUser {
  id: string
  email: string
  name: string
  image: string | null
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED'
  emailVerified: boolean
  twoFactorEnabled: boolean
  roles: RoleCode[]
  createdAt: string
}

export interface LoginCredentials {
  email: string
  password: string
}

/** Respuesta cruda de Better Auth (POST /auth/sign-in/email) — no usa el envelope {success,data,meta}. */
export interface BetterAuthSignInResult {
  redirect: boolean
  token: string
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean
    image: string | null
    twoFactorEnabled: boolean
    status: string
    deletedAt: string | null
  }
}

/** GET /users/me — nuestro endpoint (envelope normal), fuente de verdad de sesión + permisos. */
export interface MeResult extends AuthUser {
  permissions: Permission[]
}
