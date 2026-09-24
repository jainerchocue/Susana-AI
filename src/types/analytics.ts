import type { Periodo } from './dashboard'

export interface ServiceAreaSpecialty {
  area: string
  specialty: string
  lines: number
  quantity: number
}

export interface TopProcedure {
  code: string
  name: string
  count: number
}

export interface AnalyticsDailyPoint {
  day: string
  n: number
}

export interface AnalyticsServices {
  periodo: Periodo
  porAreaEspecialidad: ServiceAreaSpecialty[]
  topProcedimientos: TopProcedure[]
  serieDiaria: AnalyticsDailyPoint[]
}

export interface TriageByLevel {
  level: number
  n: number
}

export interface TriageByClassification {
  classification: string
  n: number
}

export interface TriageHourlyProfile {
  hour: number
  n: number
}

export interface AnalyticsTriage {
  periodo: Periodo
  porNivel: TriageByLevel[]
  porClasificacion: TriageByClassification[]
  perfilHorario: TriageHourlyProfile[]
  esperaPorNivel: Array<{ level: number; n: number; p50: number; p90: number; avg: number }>
}

export interface SurgeryTopProcedure {
  code: string
  name: string
  count: number
}

export interface SurgeryByUnit {
  unit: string
  count: number
}

export interface AnalyticsSurgeries {
  totalSchedules: number
  distinctProcedures: number
  withAdmissionInExtract: { count: number; pct: number }
  verifiable: {
    total: number
    executed: number
    executedPct: number
    notExecuted: number
    notExecutedPct: number
  }
  unknown: number
  topProcedures: SurgeryTopProcedure[]
  byUnit: SurgeryByUnit[]
}
