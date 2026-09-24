import type { ReactNode } from 'react'
import { useAuthStore } from '@/app/store/authStore'
import type { Permission } from '@/types'
import { ForbiddenNotice } from '@/components/ui/ForbiddenNotice'

interface RequirePermissionProps {
  permission: Permission | Permission[]
  children: ReactNode
  fallback?: ReactNode
}

/**
 * UI-only gate: hides screens the user shouldn't see. The backend re-checks every
 * request independently — this component never substitutes for server-side authorization.
 */
export function RequirePermission({ permission, children, fallback }: RequirePermissionProps) {
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const required = Array.isArray(permission) ? permission : [permission]
  const allowed = required.every((p) => hasPermission(p))

  if (!allowed) {
    return fallback ?? <ForbiddenNotice />
  }

  return <>{children}</>
}
