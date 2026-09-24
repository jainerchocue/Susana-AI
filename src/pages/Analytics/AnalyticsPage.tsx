import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartCard } from '@/components/charts'
import { GlobalFilterBar } from '@/components/filters'
import { useAnalytics } from '@/features/analytics/hooks/useAnalytics'
import { useGlobalFilters } from '@/hooks/useGlobalFilters'
import { useAuthStore } from '@/app/store/authStore'
import { toast } from '@/app/store/toastStore'
import { PERMISSIONS } from '@/constants'
import { analyticsApi } from '@/services/api'
import { Button, Card, CardBody, CardHeader, PageHeader, QueryStateView } from '@/components/ui'
import { getDisplayErrorMessage } from '@/utils/errors'
import { formatDate, formatNumber, formatPercent } from '@/utils/format'

const GRID_COLOR = '#e3e6ed'
const AXIS_TEXT_COLOR = '#64647c'
const BAR_COLOR = '#29235c'

function buildPeriodLabel(from: string | null, to: string | null): string {
  if (from && to) return `${formatDate(from)} — ${formatDate(to)}`
  if (from) return `Desde ${formatDate(from)}`
  if (to) return `Hasta ${formatDate(to)}`
  return 'Todo el período disponible'
}

export default function AnalyticsPage() {
  const { filters } = useGlobalFilters()
  const { servicesQuery, triageQuery, surgeriesQuery } = useAnalytics(filters)
  const canExport = useAuthStore((state) => state.hasPermission(PERMISSIONS.ANALYTICS_EXPORT))

  const period = useMemo(() => buildPeriodLabel(filters.from, filters.to), [filters.from, filters.to])
  const exportParams = { desde: filters.from ?? undefined, hasta: filters.to ?? undefined }

  const [isExportingServices, setIsExportingServices] = useState(false)
  const [isExportingSurgeries, setIsExportingSurgeries] = useState(false)

  const handleExport = async (download: () => Promise<void>, setExporting: (value: boolean) => void, label: string) => {
    setExporting(true)
    try {
      await download()
    } catch (error) {
      toast.error(`No se pudo exportar ${label}`, getDisplayErrorMessage(error))
    } finally {
      setExporting(false)
    }
  }

  const triageLevels = (triageQuery.data?.porNivel ?? []).map((row) => ({ ...row, label: `Nivel ${row.level}` }))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analítica Operativa"
        description="Hospital Susana López de Valencia — distribución de triage, volumen por servicio y ejecución quirúrgica."
      />

      <GlobalFilterBar />

      <ChartCard
        title="Consultas por Nivel de Triage"
        period={period}
        isLoading={triageQuery.isLoading}
        isError={triageQuery.isError}
        error={triageQuery.error}
        onRetry={triageQuery.refetch}
        isEmpty={triageLevels.length === 0}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={triageLevels} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: AXIS_TEXT_COLOR }} tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
            <YAxis tick={{ fontSize: 12, fill: AXIS_TEXT_COLOR }} tickLine={false} axisLine={false} width={48} />
            <Tooltip
              cursor={{ fill: '#eef0f4' }}
              formatter={(value) => [formatNumber(Number(value)), 'Consultas']}
            />
            <Bar dataKey="n" name="Consultas" fill={BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Principales clasificaciones de triage" />
          <CardBody>
            <QueryStateView
              isLoading={triageQuery.isLoading}
              isError={triageQuery.isError}
              error={triageQuery.error}
              data={triageQuery.data?.porClasificacion}
              onRetry={triageQuery.refetch}
              isEmpty={(rows) => rows.length === 0}
            >
              {(rows) => (
                <ul className="flex flex-col divide-y divide-surface-100">
                  {rows.slice(0, 8).map((row) => (
                    <li key={row.classification} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0 truncate text-ink-700">{row.classification}</span>
                      <span className="shrink-0 font-medium text-ink-950">{formatNumber(row.n)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </QueryStateView>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Volumen por área y especialidad"
            subtitle={period}
            action={
              canExport && (
                <Button
                  variant="ghost"
                  size="sm"
                  isLoading={isExportingServices}
                  onClick={() => handleExport(() => analyticsApi.downloadServices(exportParams), setIsExportingServices, 'servicios')}
                >
                  Exportar CSV
                </Button>
              )
            }
          />
          <CardBody>
            <QueryStateView
              isLoading={servicesQuery.isLoading}
              isError={servicesQuery.isError}
              error={servicesQuery.error}
              data={servicesQuery.data?.porAreaEspecialidad}
              onRetry={servicesQuery.refetch}
              isEmpty={(rows) => rows.length === 0}
            >
              {(rows) => (
                <ul className="flex flex-col divide-y divide-surface-100">
                  {rows.slice(0, 8).map((row) => (
                    <li key={`${row.area}-${row.specialty}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate text-ink-900">{row.specialty}</p>
                        <p className="truncate text-xs text-ink-500">{row.area}</p>
                      </div>
                      <span className="shrink-0 font-medium text-ink-950">{formatNumber(row.quantity)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </QueryStateView>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Actividad quirúrgica"
          subtitle="El HIS no trae fecha de cirugía — estas cifras son acumuladas, sin período."
          action={
            canExport && (
              <Button
                variant="ghost"
                size="sm"
                isLoading={isExportingSurgeries}
                onClick={() => handleExport(analyticsApi.downloadSurgeries, setIsExportingSurgeries, 'actividad quirúrgica')}
              >
                Exportar CSV
              </Button>
            )
          }
        />
        <CardBody>
          <QueryStateView isLoading={surgeriesQuery.isLoading} isError={surgeriesQuery.isError} error={surgeriesQuery.error} data={surgeriesQuery.data} onRetry={surgeriesQuery.refetch}>
            {(data) => (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-ink-500">Programaciones</p>
                    <p className="text-lg font-semibold text-ink-950">{formatNumber(data.totalSchedules)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-500">Verificables</p>
                    <p className="text-lg font-semibold text-ink-950">{formatNumber(data.verifiable.total)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-500">Ejecutadas</p>
                    <p className="text-lg font-semibold text-status-good">{formatPercent(data.verifiable.executedPct)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-500">No ejecutadas</p>
                    <p className="text-lg font-semibold text-status-critical">
                      {formatPercent(data.verifiable.notExecutedPct)}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-ink-500">Procedimientos más frecuentes</p>
                  <ul className="flex flex-col divide-y divide-surface-100">
                    {data.topProcedures.slice(0, 5).map((proc) => (
                      <li key={proc.code} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="min-w-0 truncate text-ink-700">{proc.name}</span>
                        <span className="shrink-0 font-medium text-ink-950">{formatNumber(proc.count)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </QueryStateView>
        </CardBody>
      </Card>
    </div>
  )
}
