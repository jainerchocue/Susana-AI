export interface Periodo {
  desde: string
  hasta: string
}

export interface DashboardSummary {
  periodo: Periodo
  datosHasta: string
  admissions: {
    last24h: number
    last7d: number
    periodo: number
  }
  occupancy: {
    census: number
    physicalBeds: number
    occupancyPct: number
    metodo: string
  }
  waitTimeP50Minutes: number
  /** Solo presente si el actor tiene algún ámbito visible (medications/services/surgeries:read). */
  alerts?: {
    WARNING: number
    CRITICAL: number
  }
}

export interface OccupancyByUnit {
  unit: string
  physicalBeds: number
  census: number
  virtualCensus: number
  occupancyPct: number
}

export interface OccupancyDailyPoint {
  day: string
  census: number
  occupancyPct: number
}

export interface DashboardOccupancy {
  periodo: Periodo
  datosHasta: string
  metodo: string
  porUnidad: OccupancyByUnit[]
  serieDiaria: OccupancyDailyPoint[]
}

export interface WaitTimeByTriageLevel {
  level: number
  n: number
  p50: number
  p90: number
  avg: number
}

export interface WaitTimeDailyPoint {
  day: string
  n: number
  p50: number
}

export interface DashboardWaitTimes {
  periodo: Periodo
  porNivel: WaitTimeByTriageLevel[]
  serieDiaria: WaitTimeDailyPoint[]
}

export interface DemandByDayAndUnit {
  day: string
  unit: string
  n: number
}

export interface DemandByEntryRoute {
  entryRoute: string
  n: number
}

export interface DemandHourlyProfile {
  hour: number
  n: number
}

export interface DemandChangeByUnit {
  unit: string
  last7: number
  prev7: number
  changePct: number
}

export interface DashboardDemand {
  periodo: Periodo
  datosHasta: string
  porDiaYUnidad: DemandByDayAndUnit[]
  porViaIngreso: DemandByEntryRoute[]
  perfilHorario: DemandHourlyProfile[]
  cambioPorUnidad: DemandChangeByUnit[]
}

/** Estado visual derivado localmente para KPICard — el backend no manda "status" ni "trend". */
export type KPIStatus = 'good' | 'medium' | 'high' | 'critical'
export type Trend = 'up' | 'down' | 'flat'

export interface KPI {
  id: string
  title: string
  value: number
  unit: string
  trend?: Trend
  trendValue?: number
  period: string
  status: KPIStatus
  description?: string
}
