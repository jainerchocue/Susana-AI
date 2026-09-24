export interface ServiceRecord {
  id: number
  admissionId: number
  code: string
  procedureName: string
  quantity: number
  providedAt: string
  areaCode: string
  area: string
  specialty: string
}

export interface ServiceRecordListParams {
  cursor?: string
  limit?: number
  desde?: string
  hasta?: string
  admissionId?: number
  code?: string
  area?: string
  specialty?: string
}

export interface ServiceRecordCreateInput {
  id: number
  admissionId: number
  code: string
  procedureName?: string
  quantity: number
  providedAt: string
  areaCode: string
  area: string
  specialty: string
}

export type ServiceRecordUpdateInput = Partial<Omit<ServiceRecordCreateInput, 'id' | 'admissionId'>>
