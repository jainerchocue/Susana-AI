import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PERMISSIONS, ROUTES, queryKeys } from '@/constants'
import { alertsApi } from '@/services/api'
import { RequirePermission } from '@/app/router/RequirePermission'
import { GlobalFilterBar } from '@/components/filters'
import { useGlobalFilters } from '@/hooks/useGlobalFilters'
import {
  buildDashboardKpis,
  useDashboardOccupancy,
  useDashboardSummary,
  useDashboardWaitTimes,
} from '@/features/dashboard/hooks/useDashboardSummary'
import { KPIGrid } from '@/components/dashboard'
import { OccupancyTrendChart, WaitTimesChart } from '@/components/charts'
import { AlertsList } from '@/components/alerts'
import { Card, CardBody, CardHeader } from '@/components/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { buildPeriodLabel, formatLongDate } from '@/utils/date'

const RECENT_ALERTS_PARAMS = { limit: 5 }

function greetingForHour(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Buenos días'
  if (hour < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName
}

export default function DashboardPage() {
  const { filters } = useGlobalFilters()
  const { user } = useAuth()
  const dateFilters = { from: filters.from, to: filters.to }

  const summaryQuery = useDashboardSummary(dateFilters)
  const occupancyQuery = useDashboardOccupancy(dateFilters)
  const waitTimesQuery = useDashboardWaitTimes(dateFilters)

  const alertsQuery = useQuery({
    queryKey: queryKeys.alerts.list(RECENT_ALERTS_PARAMS),
    queryFn: () => alertsApi.list(RECENT_ALERTS_PARAMS),
  })

  const kpis = summaryQuery.data ? buildDashboardKpis(summaryQuery.data) : []
  const isRefreshing =
    !summaryQuery.isLoading && (summaryQuery.isFetching || occupancyQuery.isFetching || waitTimesQuery.isFetching)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-950">
            {greetingForHour()}
            {user && <span className="text-brand-600">, {firstName(user.name)}</span>}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {formatLongDate(new Date())} · Ocupación, tiempos de espera y alertas en tiempo real.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <GlobalFilterBar />
          {isRefreshing && (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-500" role="status">
              <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-500" />
              </span>
              Actualizando con el nuevo período…
            </span>
          )}
        </div>
      </header>

      <KPIGrid kpis={kpis} isLoading={summaryQuery.isLoading} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OccupancyTrendChart
          data={occupancyQuery.data?.serieDiaria ?? []}
          isLoading={occupancyQuery.isLoading}
          isError={occupancyQuery.isError}
          error={occupancyQuery.error}
          onRetry={occupancyQuery.refetch}
          period={buildPeriodLabel(occupancyQuery.data?.periodo.desde, occupancyQuery.data?.periodo.hasta)}
        />
        <WaitTimesChart
          data={waitTimesQuery.data?.porNivel ?? []}
          isLoading={waitTimesQuery.isLoading}
          isError={waitTimesQuery.isError}
          error={waitTimesQuery.error}
          onRetry={waitTimesQuery.refetch}
          period={buildPeriodLabel(waitTimesQuery.data?.periodo.desde, waitTimesQuery.data?.periodo.hasta)}
        />
      </div>

      <RequirePermission permission={PERMISSIONS.ALERTS_READ}>
        <Card>
          <CardHeader
            title="Alertas recientes"
            action={
              <Link to={ROUTES.ALERTS} className="text-sm font-medium text-brand-600 hover:text-brand-700">
                Ver todas
              </Link>
            }
          />
          <CardBody>
            <AlertsList
              alerts={alertsQuery.data?.data ?? []}
              isLoading={alertsQuery.isLoading}
              isError={alertsQuery.isError}
              error={alertsQuery.error}
              onRetry={alertsQuery.refetch}
            />
          </CardBody>
        </Card>
      </RequirePermission>
    </div>
  )
}