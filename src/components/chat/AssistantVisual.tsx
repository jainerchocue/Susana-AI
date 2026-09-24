import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AssistantAnswer } from '@/types'
import { AnimatedNumber } from '@/components/ui'
import { formatVisualValue, prepareVisual, type PreparedVisual } from '@/features/assistant/visual'
import { cn } from '@/utils/cn'
import { formatNumber } from '@/utils/format'

const SERIES_COLORS = ['#29235c', '#c3bce0']
const PROJECTION_COLOR = '#76b82a'
const GRID_COLOR = '#e3e6ed'
const AXIS_TEXT_COLOR = '#64647c'
/** Etiquetas más largas que esto se leen mejor en barras horizontales (nombres de medicamentos, diagnósticos). */
const LONG_LABEL = 14

function shorten(text: string, max = 22): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function KpiView({ prepared }: { prepared: PreparedVisual }) {
  const values = prepared.points[0]?.values ?? {}
  return (
    <div className={cn('grid gap-2', prepared.columns.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
      {prepared.columns.map((column) => {
        const value = values[column.key]
        return (
          <div key={column.key} className="rounded-lg border border-surface-100 bg-white px-3 py-2">
            <p className="text-[11px] font-medium text-ink-500">{column.label}</p>
            {value === null || value === undefined ? (
              <p className="text-xl font-bold text-ink-300">—</p>
            ) : (
              <p className="flex items-baseline gap-1">
                <AnimatedNumber
                  value={value}
                  format={(n) => formatNumber(n, column.decimals ?? 1)}
                  className="text-xl font-bold tabular-nums tracking-tight text-ink-950"
                />
                {column.unit && <span className="text-xs text-ink-500">{column.unit}</span>}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ChartTooltip({ prepared, label, payload }: { prepared: PreparedVisual; label?: unknown; payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }> }) {
  if (!payload || payload.length === 0) return null
  const projectionLabel = prepared.spec.projection?.label ?? 'Proyección'
  return (
    <div className="rounded-lg border border-surface-100 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-ink-900">{String(label ?? '')}</p>
      {payload.map((item) => {
        const key = String(item.dataKey)
        const column = prepared.columns.find((c) => c.key === key) ?? prepared.columns[0]
        const value = typeof item.value === 'number' ? item.value : null
        if (value === null) return null
        return (
          <p key={key} className="mt-0.5 text-ink-700">
            {key === 'projection' ? projectionLabel : column.label}:{' '}
            <span className="font-semibold">{formatVisualValue(value, column)}</span>
          </p>
        )
      })}
    </div>
  )
}

function BarView({ prepared }: { prepared: PreparedVisual }) {
  const data = prepared.points.map((p) => ({ label: p.label, ...p.values }))
  const horizontal = prepared.points.some((p) => p.label.length > LONG_LABEL) || prepared.points.length > 8
  const height = horizontal ? Math.max(160, prepared.points.length * 30 + 40) : 220
  const showLegend = prepared.columns.length > 1

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} horizontal={!horizontal} vertical={horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tick={{ fontSize: 11, fill: AXIS_TEXT_COLOR }} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatNumber(v, 0)} />
              <YAxis
                type="category"
                dataKey="label"
                width={128}
                tick={{ fontSize: 11, fill: AXIS_TEXT_COLOR }}
                tickLine={false}
                axisLine={{ stroke: GRID_COLOR }}
                tickFormatter={(v: string) => shorten(v)}
              />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_TEXT_COLOR }} tickLine={false} axisLine={{ stroke: GRID_COLOR }} interval={0} tickFormatter={(v: string) => shorten(v, 12)} />
              <YAxis tick={{ fontSize: 11, fill: AXIS_TEXT_COLOR }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => formatNumber(v, 0)} />
            </>
          )}
          <Tooltip cursor={{ fill: '#eef0f4' }} content={({ label, payload }) => <ChartTooltip prepared={prepared} label={label} payload={payload} />} />
          {showLegend && <Legend wrapperStyle={{ fontSize: 11, color: AXIS_TEXT_COLOR }} />}
          {prepared.columns.map((column, index) => (
            <Bar
              key={column.key}
              dataKey={column.key}
              name={column.label}
              fill={SERIES_COLORS[index % SERIES_COLORS.length]}
              radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              maxBarSize={22}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function LineView({ prepared }: { prepared: PreparedVisual }) {
  const main = prepared.columns[0]
  const data = prepared.points.map((p) => ({ label: p.label, [main.key]: p.values[main.key], projection: p.projection ?? null }))
  const hasProjection = Boolean(prepared.spec.projection)

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_TEXT_COLOR }} tickLine={false} axisLine={{ stroke: GRID_COLOR }} minTickGap={16} />
          <YAxis tick={{ fontSize: 11, fill: AXIS_TEXT_COLOR }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => formatNumber(v, 0)} />
          <Tooltip content={({ label, payload }) => <ChartTooltip prepared={prepared} label={label} payload={payload} />} />
          {hasProjection && <Legend wrapperStyle={{ fontSize: 11, color: AXIS_TEXT_COLOR }} />}
          <Line type="monotone" dataKey={main.key} name={main.label} stroke={SERIES_COLORS[0]} strokeWidth={2} dot={false} connectNulls={false} />
          {hasProjection && (
            <Line
              type="monotone"
              dataKey="projection"
              name={prepared.spec.projection?.label ?? 'Proyección'}
              stroke={PROJECTION_COLOR}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 2 }}
              connectNulls={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function DataTable({ prepared }: { prepared: PreparedVisual }) {
  const [sort, setSort] = useState<{ index: number; dir: 'asc' | 'desc' } | null>(null)
  const rows = useMemo(() => {
    if (!sort) return prepared.table.rows
    return [...prepared.table.rows].sort((a, b) => {
      const x = a[sort.index]?.sort
      const y = b[sort.index]?.sort
      if (x === y) return 0
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es')
      return sort.dir === 'asc' ? order : -order
    })
  }, [prepared.table.rows, sort])

  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-surface-100 bg-white">
      <table className="w-full min-w-max border-collapse text-xs">
        <thead className="sticky top-0 bg-surface-50">
          <tr>
            {prepared.table.headers.map((header, index) => {
              const active = sort?.index === index
              return (
                <th key={`${header}-${index}`} scope="col" className="border-b border-surface-100 px-2.5 py-1.5 text-left font-semibold text-ink-700">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-brand-600"
                    onClick={() => setSort({ index, dir: active && sort?.dir === 'desc' ? 'asc' : 'desc' })}
                    aria-label={`Ordenar por ${header}`}
                  >
                    {header}
                    <span aria-hidden="true" className={cn('text-[10px]', active ? 'text-brand-600' : 'text-ink-300')}>
                      {active ? (sort?.dir === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-white even:bg-surface-50/60">
              {row.map((c, index) => (
                <td key={index} className={cn('border-b border-surface-100 px-2.5 py-1.5 text-ink-900', typeof c.sort === 'number' && 'text-right tabular-nums')}>
                  {c.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ViewToggle({ value, onChange }: { value: 'chart' | 'table'; onChange: (v: 'chart' | 'table') => void }) {
  return (
    <div role="group" aria-label="Vista" className="inline-flex shrink-0 rounded-md border border-surface-100 bg-white p-0.5 text-[11px]">
      {(['chart', 'table'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn('rounded px-2 py-0.5 font-medium', value === option ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-900')}
        >
          {option === 'chart' ? 'Gráfica' : 'Tabla'}
        </button>
      ))}
    </div>
  )
}

/**
 * Tabla o gráfica de la respuesta del asistente. Los números salen de las filas
 * que ejecutó el backend (`queries`), nunca del texto; la proyección se dibuja
 * aparte, discontinua y rotulada. Sin especificación válida no pinta nada.
 */
export function AssistantVisual({ answer }: { answer: AssistantAnswer }) {
  const prepared = useMemo(() => prepareVisual(answer), [answer])
  const [view, setView] = useState<'chart' | 'table'>('chart')
  if (!prepared) return null

  const { spec } = prepared
  const canToggle = spec.type === 'bar' || spec.type === 'line'

  return (
    <section aria-label={spec.title} className="animate-fade-up rounded-xl border border-surface-100 bg-surface-50 p-3">
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-xs font-semibold text-ink-900">{spec.title}</h4>
          {spec.subtitle && <p className="mt-0.5 text-[11px] leading-snug text-ink-500">{spec.subtitle}</p>}
        </div>
        {canToggle && <ViewToggle value={view} onChange={setView} />}
      </header>
      {spec.type === 'kpi' ? (
        <KpiView prepared={prepared} />
      ) : spec.type === 'table' || view === 'table' ? (
        <DataTable prepared={prepared} />
      ) : spec.type === 'bar' ? (
        <BarView prepared={prepared} />
      ) : (
        <LineView prepared={prepared} />
      )}
      {spec.projection && view === 'chart' && (
        <p className="mt-1.5 text-[10px] text-ink-500">La línea discontinua es una proyección orientativa, no un dato registrado.</p>
      )}
    </section>
  )
}
