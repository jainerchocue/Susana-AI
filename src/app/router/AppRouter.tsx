import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { RequirePermission } from './RequirePermission'
import { PERMISSIONS, ROUTES } from '@/constants'
import { AppShell } from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui'

const LoginPage = lazy(() => import('@/pages/Login/LoginPage'))
const DashboardPage = lazy(() => import('@/pages/Dashboard/DashboardPage'))
const AnalyticsPage = lazy(() => import('@/pages/Analytics/AnalyticsPage'))
const MedicationsPage = lazy(() => import('@/pages/Medications/MedicationsPage'))
const ServicesPage = lazy(() => import('@/pages/Services/ServicesPage'))
const AlertsPage = lazy(() => import('@/pages/Alerts/AlertsPage'))
const AssistantPage = lazy(() => import('@/pages/Assistant/AssistantPage'))
const SettingsPage = lazy(() => import('@/pages/Settings/SettingsPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFound/NotFoundPage'))

function PageFallback() {
  return (
    <div className="flex h-64 w-full items-center justify-center">
      <Spinner label="Cargando página" />
    </div>
  )
}

function withSuspense(element: ReactNode) {
  return <Suspense fallback={<PageFallback />}>{element}</Suspense>
}

const router = createBrowserRouter([
  { path: ROUTES.LOGIN, element: withSuspense(<LoginPage />) },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          {
            path: ROUTES.DASHBOARD,
            element: withSuspense(
              <RequirePermission permission={PERMISSIONS.DASHBOARD_READ}>
                <DashboardPage />
              </RequirePermission>,
            ),
          },
          {
            path: ROUTES.ANALYTICS,
            element: withSuspense(
              <RequirePermission permission={PERMISSIONS.ANALYTICS_READ}>
                <AnalyticsPage />
              </RequirePermission>,
            ),
          },
          {
            path: ROUTES.MEDICATIONS,
            element: withSuspense(
              <RequirePermission permission={PERMISSIONS.MEDICATIONS_READ}>
                <MedicationsPage />
              </RequirePermission>,
            ),
          },
          {
            path: ROUTES.SERVICES,
            element: withSuspense(
              <RequirePermission permission={PERMISSIONS.SERVICES_READ}>
                <ServicesPage />
              </RequirePermission>,
            ),
          },
          {
            path: ROUTES.ALERTS,
            element: withSuspense(
              <RequirePermission permission={PERMISSIONS.ALERTS_READ}>
                <AlertsPage />
              </RequirePermission>,
            ),
          },
          {
            path: ROUTES.ASSISTANT,
            element: withSuspense(
              <RequirePermission permission={PERMISSIONS.ASSISTANT_USE}>
                <AssistantPage />
              </RequirePermission>,
            ),
          },
          {
            // Configuración solo exige sesión válida (GET /users/me), no un permiso específico.
            path: ROUTES.SETTINGS,
            element: withSuspense(<SettingsPage />),
          },
        ],
      },
    ],
  },
  { path: '*', element: withSuspense(<NotFoundPage />) },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
