export type ImportTable =
  | 'patients'
  | 'admissions'
  | 'triages'
  | 'first-care'
  | 'service-records'
  | 'dispenses'
  | 'surgery-schedules'

export type ImportStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'

export interface ImportJobError {
  linea: number
  motivo: string
}

export interface ImportJob {
  id: string
  table: ImportTable
  status: ImportStatus
  fileName: string | null
  fileBytes: number
  delimiter: string | null
  processed: number
  inserted: number
  duplicates: number
  skipped: number
  invalid: number
  warnings: number
  errors: ImportJobError[] | null
  message: string | null
  createdBy: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface ImportListParams {
  cursor?: string
  limit?: number
  status?: ImportStatus
  table?: ImportTable
}
