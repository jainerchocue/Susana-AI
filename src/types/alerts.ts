export type AlertSeverity = 'WARNING' | 'CRITICAL'
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
export type AlertType =
  | 'LOW_STOCK'
  | 'HIGH_OCCUPANCY'
  | 'LONG_WAIT'
  | 'DEMAND_SPIKE'
  | 'SURGERY_CANCELLATIONS'
  | (string & {})

export interface Alert {
  id: string
  type: AlertType
  severity: AlertSeverity
  status: AlertStatus
  scope: string
  scopeId: string | null
  metric: string
  value: number
  threshold: number
  message: string
  firstSeenAt: string
  lastSeenAt: string
  acknowledgedAt: string | null
  resolvedAt: string | null
}

export interface AlertListParams {
  cursor?: string
  limit?: number
  status?: AlertStatus
  severity?: AlertSeverity
  type?: AlertType
  scope?: string
}

export interface AlertEvaluationResult {
  creadas: number
  actualizadas: number
  resueltas: number
  evaluadoEn: string
}
