export type MedicationKind = 'medicamento' | (string & {})
/** Confirmado contra datos reales: enum en mayúsculas, 'insufficient_data' es la única excepción en minúscula. */
export type MedicationRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'insufficient_data' | (string & {})
export type MedicationRotation = 'FAST' | 'NORMAL' | 'SLOW' | 'insufficient_data' | (string & {})

export interface Medication {
  code: string
  name: string
  kind: MedicationKind
  quantity: number
  lines: number
  lastDispensedAt: string | null
  /** null si nunca se ha registrado stock para este código (PUT /medications/{code}/stock). */
  stock: number | null
  avgDailyConsumption: number | 'insufficient_data'
  daysOfInventory: number | 'insufficient_data'
  risk: MedicationRisk
  rotation: MedicationRotation
}

export interface MedicationListParams extends Record<string, unknown> {
  desde?: string
  hasta?: string
  page?: number
  limit?: number
  search?: string
  kind?: string
}

/** GET /medications/critical — puede no tener datos suficientes si no hay stock registrado. */
export interface MedicationsCritical {
  status: 'ok' | 'insufficient_data'
  reason?: string
  items: Medication[]
}

export interface MedicationConsumptionPoint {
  date: string
  quantity: number
}

export interface MedicationConsumptionTop {
  code: string
  name: string
  quantity: number
}

export interface MedicationConsumptionByArea {
  area: string
  quantity: number
}

export interface MedicationConsumption {
  desde: string
  hasta: string
  grain: string
  code: string | null
  series: MedicationConsumptionPoint[]
  top: MedicationConsumptionTop[]
  byArea: MedicationConsumptionByArea[]
}
