import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { AssistantAnswer, AssistantVisual, AssistantVisualColumn } from '@/types'
import { formatNumber } from '@/utils/format'

/**
 * Convierte la especificación visual del backend en datos listos para dibujar.
 * Todos los valores observados salen de `queries[queryIndex].rows` (lo que el
 * backend ejecutó); de la especificación solo se toman columnas, etiquetas y,
 * aparte, la proyección. Es defensiva: una columna que no esté en el resultado
 * se ignora, y si no queda nada que dibujar devuelve null (la UI se queda con el texto).
 */

export interface VisualPoint {
  /** Valor crudo de la categoría, o `YYYY-MM-DD` en series temporales. */
  id: string
  label: string
  values: Record<string, number | null>
  /** Solo en series con proyección: valor proyectado (el último punto observado lo repite para unir la línea). */
  projection?: number | null
}

export interface PreparedVisual {
  spec: AssistantVisual
  columns: AssistantVisualColumn[]
  points: VisualPoint[]
  table: { headers: string[]; rows: Array<Array<{ text: string; sort: number | string | null }>> }
}

/** Historia visible junto a una proyección: suficiente para ver el patrón semanal sin aplastar el gráfico. */
const HISTORIA_CON_PROYECCION = 45

type Row = Record<string, string | number | null>

export function formatVisualValue(value: number | null | undefined, column?: AssistantVisualColumn): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const text = formatNumber(value, column?.decimals ?? 1)
  if (!column?.unit) return text
  return column.unit === '%' ? `${text} %` : `${text} ${column.unit}`
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function dayId(value: unknown): string | null {
  // El backend entrega los cortes por día/semana/mes como medianoche UTC del día LOCAL: basta la fecha.
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null
}

function parseDay(id: string): Date {
  const [y, m, d] = id.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toDayId(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function nextPeriod(date: Date, grain: AssistantVisual['grain']): Date {
  const next = new Date(date)
  if (grain === 'week') next.setDate(next.getDate() + 7)
  else if (grain === 'month') next.setMonth(next.getMonth() + 1)
  else if (grain === 'year') next.setFullYear(next.getFullYear() + 1)
  else next.setDate(next.getDate() + 1)
  return next
}

export function formatPeriod(id: string, grain: AssistantVisual['grain']): string {
  const date = parseDay(id)
  if (grain === 'month') return format(date, 'MMM yyyy', { locale: es })
  if (grain === 'year') return format(date, 'yyyy')
  if (grain === 'week') return `Sem. ${format(date, 'd MMM', { locale: es })}`
  return format(date, 'd MMM', { locale: es })
}

function categoryLabel(value: unknown, labels: Record<string, string> | undefined): string {
  if (value === null || value === undefined || value === '') return 'Sin dato'
  const raw = String(value)
  return labels?.[raw] ?? raw
}

function cell(value: unknown, column: AssistantVisualColumn, labels: Record<string, string> | undefined) {
  if (typeof value === 'number') {
    return { text: formatVisualValue(value, { ...column, decimals: column.decimals ?? 2 }), sort: value }
  }
  if (value === null || value === undefined || value === '') return { text: '—', sort: null }
  return { text: categoryLabel(value, labels), sort: categoryLabel(value, labels) }
}

function linePoints(spec: AssistantVisual, rows: Row[], columns: AssistantVisualColumn[]): VisualPoint[] {
  const x = spec.x as string
  const omit = new Set((spec.omit ?? []).map((value) => dayId(value) ?? value))
  const byDay = new Map<string, Row>()
  for (const row of rows) {
    const id = dayId(row[x])
    if (id && !omit.has(id)) byDay.set(id, row)
  }
  let ids = [...byDay.keys()].sort()
  if (spec.fillMissing && ids.length > 1) {
    const filled: string[] = []
    const last = parseDay(ids[ids.length - 1])
    for (let d = parseDay(ids[0]); d <= last; d = nextPeriod(d, spec.grain)) filled.push(toDayId(d))
    ids = filled.filter((id) => !omit.has(id))
  }

  let points: VisualPoint[] = ids.map((id) => {
    const row = byDay.get(id)
    const values: Record<string, number | null> = {}
    for (const column of columns) values[column.key] = row ? toNumber(row[column.key]) : spec.fillMissing ? 0 : null
    return { id, label: formatPeriod(id, spec.grain), values }
  })

  const projection = spec.projection?.points.filter((p) => Number.isFinite(p.y)) ?? []
  if (projection.length > 0) {
    points = points.slice(-HISTORIA_CON_PROYECCION)
    const last = points[points.length - 1]
    if (last) last.projection = last.values[columns[0].key] // une la línea observada con la proyectada
    for (const p of projection) {
      points.push({ id: p.x, label: formatPeriod(p.x, spec.grain ?? 'day'), values: { [columns[0].key]: null }, projection: p.y })
    }
  }
  return points
}

export function prepareVisual(answer: AssistantAnswer | undefined): PreparedVisual | null {
  const spec = answer?.visual
  if (!spec) return null
  const result = answer.queries[spec.queryIndex]
  if (!result || result.rows.length === 0) return null

  const available = new Set(result.columns)
  const columns = spec.columns.filter((column) => available.has(column.key))
  if (columns.length === 0) return null
  if ((spec.type === 'bar' || spec.type === 'line') && (!spec.x || !available.has(spec.x))) return null

  const rows = result.rows as Row[]
  let points: VisualPoint[]
  if (spec.type === 'line') {
    points = linePoints(spec, rows, columns)
  } else if (spec.type === 'kpi') {
    const values: Record<string, number | null> = {}
    for (const column of columns) values[column.key] = toNumber(rows[0][column.key])
    points = [{ id: 'kpi', label: spec.title, values }]
  } else {
    points = rows.map((row, index) => {
      const values: Record<string, number | null> = {}
      for (const column of columns) values[column.key] = toNumber(row[column.key])
      const raw = spec.x ? row[spec.x] : index
      return { id: String(raw ?? index), label: spec.x ? categoryLabel(raw, spec.valueLabels) : String(index + 1), values }
    })
  }
  if (points.length === 0) return null

  // Vista de tabla: en `table` son las filas tal cual; en gráficas, los puntos dibujados.
  const table =
    spec.type === 'table'
      ? {
          headers: columns.map((column) => (column.unit ? `${column.label} (${column.unit})` : column.label)),
          rows: rows.map((row) => columns.map((column) => cell(row[column.key], column, spec.valueLabels))),
        }
      : {
          headers: [
            ...(spec.type === 'kpi' ? [] : [spec.xLabel ?? '']),
            ...columns.map((column) => (column.unit ? `${column.label} (${column.unit})` : column.label)),
            ...(spec.projection ? [spec.projection.label] : []),
          ],
          rows: points
            .filter((p) => spec.type !== 'line' || Object.values(p.values).some((v) => v !== null) || p.projection != null)
            .map((p) => [
              ...(spec.type === 'kpi' ? [] : [{ text: p.label, sort: p.id }]),
              ...columns.map((column) => ({ text: formatVisualValue(p.values[column.key], column), sort: p.values[column.key] })),
              ...(spec.projection
                ? [{ text: p.values[columns[0].key] === null ? formatVisualValue(p.projection, columns[0]) : '—', sort: p.projection ?? null }]
                : []),
            ]),
        }

  return { spec, columns, points, table }
}
