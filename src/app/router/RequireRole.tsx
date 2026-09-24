import type { ReactNode } from 'react'
import { useAuthStore } from '@/app/store/authStore'
import type { RoleCode } from '@/types'
import { ForbiddenNotice } from '@/components/ui/ForbiddenNotice'

interface RequireRoleProps {
  role: RoleCode | RoleCode[]
  children: ReactNode
  fallback?: ReactNode
}

/** UI-only gate — see RequirePermission for why the backend remains the authority. */
export function RequireRole({ role, children, fallback }: RequireRoleProps) {
  const hasRole = useAuthStore((state) => state.hasRole)
  const allowedRoles = Array.isArray(role) ? role : [role]
  const allowed = hasRole(...allowedRoles)

  if (!allowed) {
    return fallback ?? <ForbiddenNotice />
  }

  return <>{children}</>
}
