import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { OccupancyByUnit } from '@/types'
import { formatNumber, formatPercent } from '@/utils/format'
import { ChartCard } from './ChartCard'

const COLOR_CRITICAL = '#dc2626'
const COLOR_HIGH = '#ea580c'
const COLOR_NORMAL = '#76b82a'
const GRID_COLOR = '#e3e6ed'
const AXIS_TEXT_COLOR = '#64647c'

function occupancyColor(rate: number): string {
  if (rate >= 90) return COLOR_CRITICAL
  if (rate >= 75) return COLOR_HIGH
  return COLOR_NORMAL
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {label}
    </span>
  )
}

export interface OccupancyByUnitChartProps {
  data: OccupancyByUnit[]
  isLoading: boolean
  isError: boolean
  error?: unknown
  onRetry?: () => void
  period?: string
}

/**
 * Ocupación actual por unidad hospitalaria, coloreada según nivel de riesgo.
 * El censo puede superar el 100% (camas virtuales) — ver nota en la página.
 */
export function OccupancyByUnitChart({ data, isLoading, isError, error, onRetry, period }: OccupancyByUnitChartProps) {
  const isEmpty = data.length === 0

  return (
    <ChartCard
      title="Ocupación por Unidad"
      unit="%"
      period={period}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={onRetry}
      isEmpty={isEmpty}
      legend={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <LegendSwatch color={COLOR_CRITICAL} label="Crítico (≥90%)" />
          <LegendSwatch color={COLOR_HIGH} label="Alto (≥75%)" />
          <LegendSwatch color={COLOR_NORMAL} label="Normal" />
        </span>
      }
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
          <YAxis
            tickFormatter={(value: number) => formatPercent(value, 0)}
            tick={{ fontSize: 12, fill: AXIS_TEXT_COLOR }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            cursor={{ fill: '#eef0f4' }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null
              const row = payload[0]?.payload as OccupancyByUnit | undefined
              if (!row) return null
              return (
                <div className="rounded-lg border border-surface-100 bg-white px-3 py-2 text-xs shadow-md">
                  <p className="font-medium text-ink-900">{row.unit}</p>
                  <p className="mt-1 text-ink-700">
                    Ocupación: <span className="font-semibold">{formatPercent(row.occupancyPct)}</span>
                  </p>
                  <p className="text-ink-500">
                    {formatNumber(row.census)} de {formatNumber(row.physicalBeds)} camas físicas
                  </p>
                </div>
              )
            }}
          />
          <Bar dataKey="occupancyPct" name="Ocupación" radius={[4, 4, 0, 0]} maxBarSize={32}>
            {data.map((entry) => (
              <Cell key={entry.unit} fill={occupancyColor(entry.occupancyPct)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
