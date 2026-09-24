export type SurgeryExecuted = 'si' | 'no' | 'desconocido'

export interface SurgerySchedule {
  id: number
  scheduleNumber: string
  patientId: number
  admissionId: number | null
  procedureCode: string
  executed: SurgeryExecuted
}

export interface SurgeryScheduleListParams {
  cursor?: string
  limit?: number
  scheduleNumber?: string
  admissionId?: number
  procedureCode?: string
  executed?: SurgeryExecuted
}

export interface SurgeryScheduleCreateInput {
  scheduleNumber: string
  patientId: number
  admissionId?: number | null
  procedureCode: string
}

export type SurgeryScheduleUpdateInput = Partial<SurgeryScheduleCreateInput>
