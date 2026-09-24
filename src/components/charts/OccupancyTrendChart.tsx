import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { OccupancyDailyPoint } from '@/types'
import { formatDate, formatPercent } from '@/utils/format'
import { ChartCard } from './ChartCard'

const LINE_COLOR = '#29235c'
const GRID_COLOR = '#e3e6ed'
const AXIS_TEXT_COLOR = '#64647c'

export interface OccupancyTrendChartProps {
  data: OccupancyDailyPoint[]
  isLoading: boolean
  isError: boolean
  error?: unknown
  onRetry?: () => void
  period?: string
}

/** Evolución de la ocupación hospitalaria general a lo largo del tiempo. */
export function OccupancyTrendChart({ data, isLoading, isError, error, onRetry, period }: OccupancyTrendChartProps) {
  const isEmpty = data.length === 0

  return (
    <ChartCard
      title="Evolución de Ocupación"
      unit="%"
      period={period}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={onRetry}
      isEmpty={isEmpty}
      legend={
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: LINE_COLOR }} aria-hidden="true" />
          Ocupación general (%)
        </span>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={(value: string) => formatDate(value)}
            tick={{ fontSize: 12, fill: AXIS_TEXT_COLOR }}
            tickLine={false}
            axisLine={{ stroke: GRID_COLOR }}
          />
          <YAxis
            tickFormatter={(value: number) => formatPercent(value, 0)}
            tick={{ fontSize: 12, fill: AXIS_TEXT_COLOR }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            cursor={{ stroke: GRID_COLOR, strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null
              const raw = payload[0]?.value
              const value = typeof raw === 'number' ? raw : Number(raw)
              return (
                <div className="rounded-lg border border-surface-100 bg-white px-3 py-2 text-xs shadow-md">
                  <p className="font-medium text-ink-900">{formatDate(String(label))}</p>
                  <p className="mt-1 text-ink-700">
                    Ocupación: <span className="font-semibold">{formatPercent(value)}</span>
                  </p>
                </div>
              )
            }}
          />
          <Line
            type="monotone"
            dataKey="occupancyPct"
            name="Ocupación"
            stroke={LINE_COLOR}
            strokeWidth={2}
            dot={{ r: 4, fill: LINE_COLOR, stroke: '#fff', strokeWidth: 2 }}
            activeDot={{ r: 6, fill: LINE_COLOR, stroke: '#fff', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
