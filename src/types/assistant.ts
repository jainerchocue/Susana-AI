export type ChatRole = 'user' | 'assistant'

export interface AssistantQueryMetric {
  agg: string
  /** Ausente en agregaciones que no necesitan columna, p. ej. `count` sobre toda la fila. */
  field?: string
}

export interface AssistantQueryFilter {
  field: string
  op?: string
  value?: unknown
}

export interface AssistantQuerySpec {
  dataset: string
  metrics?: AssistantQueryMetric[]
  groupBy?: Array<{ field: string; grain?: 'day' | 'week' | 'month' | 'year' }>
  filters?: AssistantQueryFilter[]
  orderBy?: unknown[]
  limit?: number
}

export interface AssistantQueryResult {
  query: AssistantQuerySpec
  columns: string[]
  rows: Array<Record<string, string | number | null>>
  rowCount: number
  truncated: boolean
}

export interface AssistantVisualColumn {
  /** Columna de `queries[queryIndex].rows` (p. ej. `count_all`, `avg_wait_minutes`). */
  key: string
  label: string
  unit?: string
  decimals?: number
}

/**
 * Tabla o gráfica sugerida para la respuesta. NO trae datos: los valores salen
 * de `queries[queryIndex].rows`, lo que el backend ejecutó (y validó contra esa
 * especificación). La única excepción es `projection`: valores proyectados, que
 * se dibujan aparte y rotulados como proyección.
 */
export interface AssistantVisual {
  type: 'kpi' | 'bar' | 'line' | 'table'
  title: string
  subtitle?: string
  queryIndex: number
  /** Columna de categorías (bar) o de fechas (line). */
  x?: string
  xLabel?: string
  grain?: 'day' | 'week' | 'month' | 'year'
  /** Serie de conteo/suma: un periodo sin filas vale 0 (el backend no devuelve filas vacías). */
  fillMissing?: boolean
  columns: AssistantVisualColumn[]
  /** Valor crudo -> texto para el usuario ("URGENCIAS" -> "Urgencias", "si" -> "realizadas"). */
  valueLabels?: Record<string, string>
  /** Valores de `x` que no se dibujan como dato real (periodos incompletos). */
  omit?: string[]
  projection?: { label: string; points: Array<{ x: string; y: number }> }
}

/** POST /assistant/query — texto, las queries ejecutadas y, si aplica, cómo visualizarlas. */
export interface AssistantAnswer {
  status: 'ok' | (string & {})
  answer: string
  queries: AssistantQueryResult[]
  visual?: AssistantVisual | null
}

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  createdAt: string
  answer?: AssistantAnswer
  status?: 'pending' | 'complete' | 'error' | 'cancelled'
  errorMessage?: string
}

export interface AssistantQueryRequest {
  question: string
}
