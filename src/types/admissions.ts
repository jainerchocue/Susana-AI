export interface AdmissionTriageSummary {
  id: number
  level: number | null
  code: string
  classification: string
  triagedAt: string
}

export interface Admission {
  id: number
  consecutive: number
  patientId: number
  admissionClass: string
  entryRoute: string
  riskType: string
  admittedAt: string
  hospitalizedAt: string | null
  triageId: number | null
  bedCode: string
  bedName: string
  unit: string
  subunit: string
  virtualBed: boolean
  diagnosisCode: string | null
  diagnosisName: string | null
  firstCareAt: string | null
  lastActivityAt: string | null
  triageLevel: number | null
  waitMinutes: number | null
  stayHours: number | null
  patientSex: string | null
  patientRegime: string | null
  patientZone: string | null
  patientAge: number | null
  triage: AdmissionTriageSummary | null
}

export interface AdmissionListParams {
  cursor?: string
  limit?: number
}

export interface AdmissionCreateInput {
  id: number
  consecutive: number
  patientId: number
  admissionClass: string
  entryRoute: string
  riskType: string
  admittedAt: string
  hospitalizedAt?: string | null
  triageId?: number | null
  bedCode: string
  bedName: string
  unit: string
  subunit: string
  diagnosisCode?: string | null
  diagnosisName?: string | null
}

export type AdmissionUpdateInput = Partial<Omit<AdmissionCreateInput, 'id'>>
