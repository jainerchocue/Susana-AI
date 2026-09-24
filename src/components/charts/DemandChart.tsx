import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DemandChangeByUnit } from '@/types'
import { formatNumber, formatPercent } from '@/utils/format'
import { ChartCard } from './ChartCard'

const CURRENT_COLOR = '#29235c'
const PREVIOUS_COLOR = '#c3bce0'
const GRID_COLOR = '#e3e6ed'
const AXIS_TEXT_COLOR = '#64647c'

export interface DemandChartProps {
  data: DemandChangeByUnit[]
  isLoading: boolean
  isError: boolean
  error?: unknown
  onRetry?: () => void
  period?: string
}

/** Compara los ingresos de los últimos 7 días de cada unidad contra los 7 anteriores. */
export function DemandChart({ data, isLoading, isError, error, onRetry, period }: DemandChartProps) {
  const isEmpty = data.length === 0

  return (
    <ChartCard
      title="Demanda por Unidad"
      unit="ingresos"
      period={period}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={onRetry}
      isEmpty={isEmpty}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="unit"
            tick={{ fontSize: 12, fill: AXIS_TEXT_COLOR }}
            tickLine={false}
            axisLine={{ stroke: GRID_COLOR }}
          />
          <YAxis tick={{ fontSize: 12, fill: AXIS_TEXT_COLOR }} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            cursor={{ fill: '#eef0f4' }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null
              const row = payload[0]?.payload as DemandChangeByUnit | undefined
              if (!row) return null
              const sign = row.changePct > 0 ? '+' : ''
              return (
                <div className="rounded-lg border border-surface-100 bg-white px-3 py-2 text-xs shadow-md">
                  <p className="font-medium text-ink-900">{row.unit}</p>
                  <p className="mt-1 text-ink-700">
                    Últimos 7 días: <span className="font-semibold">{formatNumber(row.last7)}</span>
                  </p>
                  <p className="text-ink-700">
                    7 días anteriores: <span className="font-semibold">{formatNumber(row.prev7)}</span>
                  </p>
                  <p className="text-ink-500">
                    Cambio: {sign}
                    {formatPercent(row.changePct)}
                  </p>
                </div>
              )
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: AXIS_TEXT_COLOR }} />
          <Bar dataKey="last7" name="Últimos 7 días" fill={CURRENT_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} />
          <Bar dataKey="prev7" name="7 días anteriores" fill={PREVIOUS_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
