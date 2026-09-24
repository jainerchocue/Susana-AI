export interface Triage {
  id: number
  triagedAt: string
  systolic: number | null
  diastolic: number | null
  heartRate: number | null
  respiratoryRate: number | null
  temperature: number | null
  patientId: number | null
  code: string
  classification: string
  level: number | null
}

export interface TriageListParams {
  cursor?: string
  limit?: number
}

export interface TriageCreateInput {
  id: number
  triagedAt: string
  systolic?: number | null
  diastolic?: number | null
  heartRate?: number | null
  respiratoryRate?: number | null
  temperature?: number | null
  patientId?: number | null
  code: string
  classification: string
  level?: number | null
}

export type TriageUpdateInput = Partial<Omit<TriageCreateInput, 'id'>>
