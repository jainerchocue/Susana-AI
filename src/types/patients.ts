export interface Patient {
  id: number
  documentType: string
  sex: string
  insurer: string
  regime: string
  department: string
  municipality: string
  zone: string
  age: number
}

export interface PatientListParams {
  cursor?: string
  limit?: number
}

export interface PatientCreateInput {
  id: number
  documentType: string
  birthDate: string
  sex: string
  insurer: string
  regime: string
  department: string
  municipality: string
  zone: string
}

export type PatientUpdateInput = Partial<Omit<PatientCreateInput, 'id'>>
