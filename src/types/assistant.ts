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

/** POST /assistant/query — el backend responde texto + las queries ejecutadas, sin bloques estructurados. */
export interface AssistantAnswer {
  status: 'ok' | (string & {})
  answer: string
  queries: AssistantQueryResult[]
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
