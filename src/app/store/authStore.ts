import { create } from 'zustand'
import type { AuthUser, Permission } from '@/types'
import { hasPermission as checkPermission } from '@/utils/permissions'
import { clearStoredAccessToken, getStoredAccessToken, storeAccessToken } from '@/utils/tokenStorage'

interface AuthState {
  user: AuthUser | null
  permissions: Permission[]
  /**
   * Better Auth emite la sesión como cookie httpOnly (SameSite=Lax) y, en
   * paralelo, un bearer token en el cuerpo de login / cabecera
   * `set-auth-token` pensado para clientes cross-site (ver api.md). La cookie
   * Lax no sobrevive a un origen distinto (frontend y backend en dominios
   * separados), así que este frontend usa el bearer token como mecanismo
   * real de sesión — persistido en sessionStorage para sobrevivir al
   * recargar de la pestaña (se limpia al cerrarla), nunca en localStorage.
   */
  accessToken: string | null
  status: 'idle' | 'authenticating' | 'authenticated' | 'unauthenticated'
  /** accessToken es null cuando la sesión llegó por la cookie (despliegue same-site), no por login. */
  setSession: (payload: { user: AuthUser; permissions: Permission[]; accessToken: string | null }) => void
  /** Deja el token disponible para el interceptor de axios antes de tener user/permissions (p. ej. justo tras sign-in, antes de llamar /users/me). */
  setAccessToken: (accessToken: string) => void
  setStatus: (status: AuthState['status']) => void
  clearSession: () => void
  hasPermission: (permission: Permission) => boolean
  hasRole: (...roles: string[]) => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  permissions: [],
  accessToken: getStoredAccessToken(),
  status: 'idle',
  setSession: ({ user, permissions, accessToken }) => {
    if (accessToken) storeAccessToken(accessToken)
    set({ user, permissions, accessToken, status: 'authenticated' })
  },
  setAccessToken: (accessToken) => {
    storeAccessToken(accessToken)
    set({ accessToken })
  },
  setStatus: (status) => set({ status }),
  clearSession: () => {
    clearStoredAccessToken()
    set({ user: null, permissions: [], accessToken: null, status: 'unauthenticated' })
  },
  hasPermission: (permission) => checkPermission(get().permissions, permission),
  hasRole: (...roles) => {
    const userRoles = get().user?.roles ?? []
    return roles.some((role) => userRoles.includes(role))
  },
}))
