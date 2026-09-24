import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { OccupancyByUnitChart, OccupancyTrendChart } from '@/components/charts'
import { Card, CardBody, CardHeader, PageHeader, QueryStateView } from '@/components/ui'
import { PERMISSIONS } from '@/constants'
import { RequirePermission } from '@/app/router/RequirePermission'
import { useGlobalFilters } from '@/hooks/useGlobalFilters'
import { GlobalFilterBar } from '@/components/filters'
import { useOccupancyByUnit } from '@/features/services/hooks/useServices'
import { useSurgeriesAnalytics } from '@/features/surgeries/hooks/useSurgeries'
import { formatNumber, formatPercent } from '@/utils/format'

const GRID_COLOR = '#e3e6ed'
const AXIS_TEXT_COLOR = '#64647c'
const BAR_COLOR = '#327531'

export default function ServicesPage() {
  const { filters } = useGlobalFilters()
  const occupancyQuery = useOccupancyByUnit(filters)
  const surgeriesQuery = useSurgeriesAnalytics()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Servicios"
        description="Ocupación por unidad hospitalaria y actividad quirúrgica por unidad."
      />

      <GlobalFilterBar />

      {occupancyQuery.data && occupancyQuery.data.metodo && (
        <p className="text-xs text-ink-500">
          Método de cálculo: {occupancyQuery.data.metodo}. El censo puede superar el 100% en unidades con camas
          virtuales.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OccupancyTrendChart
          data={occupancyQuery.data?.serieDiaria ?? []}
          isLoading={occupancyQuery.isLoading}
          isError={occupancyQuery.isError}
          error={occupancyQuery.error}
          onRetry={occupancyQuery.refetch}
        />
        <OccupancyByUnitChart
          data={occupancyQuery.data?.porUnidad ?? []}
          isLoading={occupancyQuery.isLoading}
          isError={occupancyQuery.isError}
          error={occupancyQuery.error}
          onRetry={occupancyQuery.refetch}
        />
      </div>

      <RequirePermission permission={PERMISSIONS.SURGERIES_READ}>
        <Card>
          <CardHeader title="Actividad quirúrgica por unidad" subtitle="Programaciones del ingreso vinculado, por unidad" />
          <CardBody>
            <QueryStateView
              isLoading={surgeriesQuery.isLoading}
              isError={surgeriesQuery.isError}
              error={surgeriesQuery.error}
              data={surgeriesQuery.data?.byUnit}
              onRetry={surgeriesQuery.refetch}
              isEmpty={(rows) => rows.length === 0}
            >
              {(rows) => (
                <div className="h-70 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={GRID_COLOR} vertical={false} />
                      <XAxis dataKey="unit" tick={{ fontSize: 12, fill: AXIS_TEXT_COLOR }} tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
                      <YAxis tick={{ fontSize: 12, fill: AXIS_TEXT_COLOR }} tickLine={false} axisLine={false} width={48} />
                      <Tooltip cursor={{ fill: '#eef0f4' }} formatter={(value) => [formatNumber(Number(value)), 'Programaciones']} />
                      <Bar dataKey="count" name="Programaciones" fill={BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </QueryStateView>
            {surgeriesQuery.data && (
              <p className="mt-3 text-xs text-ink-500">
                {formatPercent(surgeriesQuery.data.verifiable.executedPct)} de las programaciones verificables se
                ejecutaron.
              </p>
            )}
          </CardBody>
        </Card>
      </RequirePermission>
    </div>
  )
}
