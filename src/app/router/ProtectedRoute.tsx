import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/app/store/authStore'
import { useSessionBootstrap } from '@/features/auth/hooks/useSessionBootstrap'
import { ROUTES } from '@/constants'
import { Spinner } from '@/components/ui'

export function ProtectedRoute() {
  const location = useLocation()
  const status = useAuthStore((state) => state.status)
  const { isBootstrapping } = useSessionBootstrap()

  if (isBootstrapping) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-surface-0">
        <Spinner label="Verificando sesión" />
      </div>
    )
  }

  if (status !== 'authenticated') {
    return <Navigate to={ROUTES.LOGIN} replace state={{ from: location }} />
  }

  return <Outlet />
}
