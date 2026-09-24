import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartCard } from '@/components/charts'
import { GlobalFilterBar } from '@/components/filters'
import { useAnalytics, useMedicationCatalog, useMedicationConsumption } from '@/features/analytics/hooks/useAnalytics'
import { useGlobalFilters } from '@/hooks/useGlobalFilters'
import { useAuthStore } from '@/app/store/authStore'
import { toast } from '@/app/store/toastStore'
import { PERMISSIONS } from '@/constants'
import { analyticsApi } from '@/services/api'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  QueryStateView,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type SelectOption,
} from '@/components/ui'
import { IconAlertTriangle, IconBuilding, IconCalendar, IconCapsule } from '@/components/ui/icons'
import { getDisplayErrorMessage } from '@/utils/errors'
import { formatDate, formatNumber, formatPercent } from '@/utils/format'

/** Paleta oficial HSLV: lima #76B82A · bosque #327531 · añil #29235C */
const BRAND = { lime: '#76B82A', forest: '#327531', indigo: '#29235C' }
const GRID_COLOR = '#e3e6ed'
const AXIS_TEXT_COLOR = '#64647c'

/** Triage: el color comunica urgencia (1 = más crítico). */
const LEVEL_COLORS: Record<number, string> = {
  1: '#C0392B',
  2: '#E1782B',
  3: '#E3B21F',
  4: BRAND.lime,
  5: BRAND.forest,
}
const levelColor = (level: unknown) => LEVEL_COLORS[Number(level)] ?? BRAND.indigo

function buildPeriodLabel(from: string | null, to: string | null): string {
  if (from && to) return `${formatDate(from)} — ${formatDate(to)}`
  if (from) return `Desde ${formatDate(from)}`
  if (to) return `Hasta ${formatDate(to)}`
  return 'Todo el período disponible'
}

/* ───────── Piezas visuales ───────── */

function TriageTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: { label: string; n: number } }>
}) {
  if (!active || !payload?.length) return null
  const { label, n } = payload[0].payload
  return (
    <div className="rounded-xl bg-[#29235C] px-3.5 py-2.5 text-white shadow-xl">
      <p className="text-xs text-white/70">{label}</p>
      <p className="text-lg font-semibold leading-tight">
        {formatNumber(n)} <span className="text-xs font-normal text-white/70">consultas</span>
      </p>
    </div>
  )
}

function ConsumptionTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: { date: string; quantity: number } }>
}) {
  if (!active || !payload?.length) return null
  const { date, quantity } = payload[0].payload
  return (
    <div className="rounded-xl bg-[#29235C] px-3.5 py-2.5 text-white shadow-xl">
      <p className="text-xs text-white/70">{formatDate(date)}</p>
      <p className="text-lg font-semibold leading-tight">
        {formatNumber(quantity)} <span className="text-xs font-normal text-white/70">unidades</span>
      </p>
    </div>
  )
}

/** Lista con barra proporcional: se lee el ranking sin comparar números. */
function RankedList({ items }: { items: { key: string; label: string; sub?: string; value: number }[] }) {
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <ul className="flex flex-col gap-4">
      {items.map((item) => (
        <li key={item.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="truncate text-ink-900">{item.label}</p>
              {item.sub && <p className="truncate text-xs text-ink-500">{item.sub}</p>}
            </div>
            <span className="shrink-0 font-semibold tabular-nums text-ink-950">{formatNumber(item.value)}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#29235C]/[0.07]">
            <div
              className="h-full rounded-full bg-[#327531]"
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-5 py-4 sm:px-6 sm:py-5">
      <p className="text-xs text-white/60">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-[#76B82A]">{hint}</p>}
    </div>
  )
}

/* ───────── Página ───────── */

export default function AnalyticsPage() {
  const { filters } = useGlobalFilters()
  const { servicesQuery, triageQuery, surgeriesQuery } = useAnalytics(filters)
  const canExport = useAuthStore((state) => state.hasPermission(PERMISSIONS.ANALYTICS_EXPORT))

  const [medicationCode, setMedicationCode] = useState<string | null>(null)
  const consumptionQuery = useMedicationConsumption(filters, medicationCode)
  const { medications: medicationCatalog } = useMedicationCatalog()
  const medicationOptions: SelectOption[] = medicationCatalog.map((med) => ({ label: med.name, value: med.code }))

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

  // Resumen calculado con los mismos datos de la página
  const triageTotal = triageLevels.reduce((sum, row) => sum + Number(row.n), 0)
  const topLevel = triageLevels.reduce<(typeof triageLevels)[number] | null>(
    (best, row) => (!best || Number(row.n) > Number(best.n) ? row : best),
    null,
  )
  const topLevelShare = topLevel && triageTotal > 0 ? Math.round((Number(topLevel.n) / triageTotal) * 100) : null
  const surgeries = surgeriesQuery.data
  const dash = '—'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analítica Operativa"
        description="Hospital Susana López de Valencia — distribución de triage, volumen por servicio, consumo de medicamentos y ejecución quirúrgica."
      />

      <GlobalFilterBar />

      {/* Resumen */}
      <section
        aria-label="Resumen del período"
        className="relative overflow-hidden rounded-2xl bg-[#29235C] shadow-[0_24px_50px_-28px_rgba(41,35,92,0.9)]"
      >
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-[#76B82A]/25 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 left-1/3 h-56 w-56 rounded-full bg-[#327531]/40 blur-3xl" />
        <div className="relative grid grid-cols-2 divide-white/10 sm:grid-cols-4 sm:divide-x [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-white/10 sm:[&>*:nth-child(-n+2)]:border-b-0">
          <Kpi label="Consultas de triage" value={triageQuery.data ? formatNumber(triageTotal) : dash} hint={period} />
          <Kpi
            label="Nivel más frecuente"
            value={topLevel ? topLevel.label : dash}
            hint={topLevelShare !== null ? `${topLevelShare}% de las consultas` : undefined}
          />
          <Kpi label="Programaciones quirúrgicas" value={surgeries ? formatNumber(surgeries.totalSchedules) : dash} hint="Acumulado" />
          <Kpi label="Cirugías ejecutadas" value={surgeries ? formatPercent(surgeries.verifiable.executedPct) : dash} hint="Sobre las verificables" />
        </div>
      </section>

      <Tabs defaultValue="triage">
        <TabsList>
          <TabsTrigger value="triage" icon={<IconAlertTriangle className="h-4 w-4" />}>
            Triage
          </TabsTrigger>
          <TabsTrigger value="servicios" icon={<IconBuilding className="h-4 w-4" />}>
            Servicios (área y especialidad)
          </TabsTrigger>
          <TabsTrigger value="medicamentos" icon={<IconCapsule className="h-4 w-4" />}>
            Medicamentos
          </TabsTrigger>
          <TabsTrigger value="cirugias" icon={<IconCalendar className="h-4 w-4" />}>
            Cirugías
          </TabsTrigger>
        </TabsList>

        <TabsContent value="triage">
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
              <BarChart data={triageLevels} margin={{ top: 26, right: 12, left: 0, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: AXIS_TEXT_COLOR }} tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
                <YAxis tick={{ fontSize: 12, fill: AXIS_TEXT_COLOR }} tickLine={false} axisLine={false} width={48} />
                <Tooltip cursor={{ fill: 'rgba(41,35,92,0.06)' }} content={<TriageTooltip />} />
                <Bar dataKey="n" name="Consultas" radius={[10, 10, 0, 0]} maxBarSize={56}>
                  {triageLevels.map((row) => (
                    <Cell key={row.label} fill={levelColor(row.level)} />
                  ))}
                  <LabelList
                    dataKey="n"
                    position="top"
                    formatter={(value: unknown) => formatNumber(Number(value))}
                    style={{ fontSize: 12, fontWeight: 600, fill: BRAND.indigo }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

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
                  <RankedList
                    items={rows.slice(0, 8).map((row) => ({
                      key: String(row.classification),
                      label: String(row.classification),
                      value: Number(row.n),
                    }))}
                  />
                )}
              </QueryStateView>
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="servicios">
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
                  <RankedList
                    items={rows.slice(0, 8).map((row) => ({
                      key: `${row.area}-${row.specialty}`,
                      label: String(row.specialty),
                      sub: String(row.area),
                      value: Number(row.quantity),
                    }))}
                  />
                )}
              </QueryStateView>
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="medicamentos">
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Medicamento"
              options={medicationOptions}
              placeholder="Todos los medicamentos"
              value={medicationCode ?? ''}
              onChange={(event) => setMedicationCode(event.target.value === '' ? null : event.target.value)}
              className="w-64"
            />
          </div>

          <ChartCard
            title="Consumo en el tiempo"
            unit="unidades"
            period={period}
            isLoading={consumptionQuery.isLoading}
            isError={consumptionQuery.isError}
            error={consumptionQuery.error}
            onRetry={consumptionQuery.refetch}
            isEmpty={(consumptionQuery.data?.series.length ?? 0) === 0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={consumptionQuery.data?.series ?? []} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 5" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value: string) => formatDate(value)}
                  tick={{ fontSize: 12, fill: AXIS_TEXT_COLOR }}
                  tickLine={false}
                  axisLine={{ stroke: GRID_COLOR }}
                />
                <YAxis tick={{ fontSize: 12, fill: AXIS_TEXT_COLOR }} tickLine={false} axisLine={false} width={48} />
                <Tooltip cursor={{ stroke: BRAND.indigo, strokeWidth: 1 }} content={<ConsumptionTooltip />} />
                <Line type="monotone" dataKey="quantity" name="Consumo" stroke={BRAND.forest} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Medicamentos más consumidos" subtitle={period} />
              <CardBody>
                <QueryStateView
                  isLoading={consumptionQuery.isLoading}
                  isError={consumptionQuery.isError}
                  error={consumptionQuery.error}
                  data={consumptionQuery.data?.top}
                  onRetry={consumptionQuery.refetch}
                  isEmpty={(rows) => rows.length === 0}
                >
                  {(rows) => (
                    <RankedList
                      items={rows.slice(0, 8).map((row) => ({ key: row.code, label: row.name, sub: row.code, value: row.quantity }))}
                    />
                  )}
                </QueryStateView>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Consumo por área" subtitle={period} />
              <CardBody>
                <QueryStateView
                  isLoading={consumptionQuery.isLoading}
                  isError={consumptionQuery.isError}
                  error={consumptionQuery.error}
                  data={consumptionQuery.data?.byArea}
                  onRetry={consumptionQuery.refetch}
                  isEmpty={(rows) => rows.length === 0}
                >
                  {(rows) => (
                    <RankedList items={rows.slice(0, 8).map((row) => ({ key: row.area, label: row.area, value: row.quantity }))} />
                  )}
                </QueryStateView>
              </CardBody>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="cirugias">
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
                {(data) => {
                  // Proporción calculada entre ambas cifras, sin depender de si vienen en 0–1 o 0–100
                  const executed = Number(data.verifiable.executedPct)
                  const notExecuted = Number(data.verifiable.notExecutedPct)
                  const sum = executed + notExecuted
                  const executedShare = sum > 0 ? (executed / sum) * 100 : 0

                  return (
                    <div className="grid gap-8 lg:grid-cols-2">
                      <div className="flex flex-col gap-6">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="rounded-xl bg-[#29235C]/[0.04] p-4">
                            <p className="text-xs text-ink-500">Programaciones</p>
                            <p className="mt-1 text-2xl font-semibold tracking-tight text-[#29235C]">{formatNumber(data.totalSchedules)}</p>
                          </div>
                          <div className="rounded-xl bg-[#29235C]/[0.04] p-4">
                            <p className="text-xs text-ink-500">Verificables</p>
                            <p className="mt-1 text-2xl font-semibold tracking-tight text-[#29235C]">{formatNumber(data.verifiable.total)}</p>
                          </div>
                        </div>

                        <div>
                          <p className="mb-2 text-xs font-medium text-ink-500">Ejecución de lo verificable</p>
                          <div
                            role="img"
                            aria-label={`${formatPercent(data.verifiable.executedPct)} ejecutadas, ${formatPercent(data.verifiable.notExecutedPct)} no ejecutadas`}
                            className="flex h-3.5 overflow-hidden rounded-full bg-red-100"
                          >
                            <div
                              className="h-full rounded-full bg-[#327531]"
                              style={{ width: `${executedShare}%` }}
                            />
                          </div>
                          <div className="mt-3 flex items-start justify-between gap-4 text-sm">
                            <div>
                              <p className="flex items-center gap-2 text-xs text-ink-500">
                                <span className="h-2.5 w-2.5 rounded-full bg-[#327531]" /> Ejecutadas
                              </p>
                              <p className="text-lg font-semibold text-[#327531]">{formatPercent(data.verifiable.executedPct)}</p>
                            </div>
                            <div className="text-right">
                              <p className="flex items-center justify-end gap-2 text-xs text-ink-500">
                                No ejecutadas <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
                              </p>
                              <p className="text-lg font-semibold text-status-critical">{formatPercent(data.verifiable.notExecutedPct)}</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div>
                        <p className="mb-3 text-xs font-medium text-ink-500">Procedimientos más frecuentes</p>
                        <RankedList
                          items={data.topProcedures.slice(0, 5).map((proc) => ({
                            key: String(proc.code),
                            label: String(proc.name),
                            value: Number(proc.count),
                          }))}
                        />
                      </div>
                    </div>
                  )
                }}
              </QueryStateView>
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
