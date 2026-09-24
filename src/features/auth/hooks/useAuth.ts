import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/app/store/authStore'
import { authApi } from '@/services/api'
import { ROUTES } from '@/constants'
import { NAV_ITEMS } from '@/app/router/navConfig'
import { hasPermission as checkPermission } from '@/utils/permissions'
import type { LoginCredentials, Permission } from '@/types'

/** El Dashboard no siempre es accesible (p. ej. FARMACIA no tiene dashboard:read) — aterriza en la primera sección real del usuario. */
function firstAccessibleRoute(permissions: Permission[]): string {
  const item = NAV_ITEMS.find((entry) => !entry.permission || checkPermission(permissions, entry.permission))
  return item?.path ?? ROUTES.SETTINGS
}

export function useAuth() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, permissions, status, setSession, setAccessToken, clearSession, hasPermission, hasRole } =
    useAuthStore()

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginCredentials) => {
      const { token } = await authApi.signIn(credentials)
      // El bearer token debe estar en el store ANTES de llamar /users/me — es lo que el
      // interceptor de axios adjunta como Authorization (la cookie no sobrevive cross-site).
      setAccessToken(token)
      const me = await authApi.me()
      return { me, token }
    },
    onSuccess: ({ me, token }) => {
      const { permissions: userPermissions, ...userFields } = me
      setSession({ user: userFields, permissions: userPermissions, accessToken: token })
      navigate(firstAccessibleRoute(userPermissions), { replace: true })
    },
    onError: () => {
      clearSession()
    },
  })

  const logoutMutation = useMutation({
    mutationFn: () => authApi.signOut(),
    onSettled: () => {
      clearSession()
      queryClient.clear()
      navigate(ROUTES.LOGIN, { replace: true })
    },
  })

  return {
    user,
    permissions,
    status,
    isAuthenticated: status === 'authenticated',
    hasPermission,
    hasRole,
    login: loginMutation.mutateAsync,
    isLoggingIn: loginMutation.isPending,
    loginError: loginMutation.error,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  }
}
