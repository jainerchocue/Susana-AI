import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { WaitTimeByTriageLevel } from '@/types'
import { formatNumber } from '@/utils/format'
import { ChartCard } from './ChartCard'

const BAR_COLOR = '#29235c'
const GRID_COLOR = '#e3e6ed'
const AXIS_TEXT_COLOR = '#64647c'

export interface WaitTimesChartProps {
  data: WaitTimeByTriageLevel[]
  isLoading: boolean
  isError: boolean
  error?: unknown
  onRetry?: () => void
  period?: string
}

/** Tiempo de espera (mediana p50) por nivel de triage. */
export function WaitTimesChart({ data, isLoading, isError, error, onRetry, period }: WaitTimesChartProps) {
  const isEmpty = data.length === 0
  const chartData = data.map((row) => ({ ...row, label: `Nivel ${row.level}` }))

  return (
    <ChartCard
      title="Tiempos de Espera por Nivel de Triage"
      unit="min"
      period={period}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={onRetry}
      isEmpty={isEmpty}
      legend={
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: BAR_COLOR }} aria-hidden="true" />
          Mediana de espera (p50, min)
        </span>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: AXIS_TEXT_COLOR }}
            tickLine={false}
            axisLine={{ stroke: GRID_COLOR }}
          />
          <YAxis tick={{ fontSize: 12, fill: AXIS_TEXT_COLOR }} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            cursor={{ fill: '#eef0f4' }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null
              const row = payload[0]?.payload as (WaitTimeByTriageLevel & { label: string }) | undefined
              if (!row) return null
              return (
                <div className="rounded-lg border border-surface-100 bg-white px-3 py-2 text-xs shadow-md">
                  <p className="font-medium text-ink-900">{row.label}</p>
                  <p className="mt-1 text-ink-700">
                    Mediana (p50): <span className="font-semibold">{formatNumber(row.p50)} min</span>
                  </p>
                  <p className="text-ink-500">
                    p90: {formatNumber(row.p90)} min · promedio: {formatNumber(row.avg)} min
                  </p>
                  <p className="text-ink-500">{formatNumber(row.n)} pacientes</p>
                </div>
              )
            }}
          />
          <Bar dataKey="p50" name="Mediana de espera" fill={BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
