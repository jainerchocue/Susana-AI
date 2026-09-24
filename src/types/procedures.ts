export interface Procedure {
  code: string
  name: string
}

export interface ProcedureListParams {
  cursor?: string
  limit?: number
}

export interface ProcedureCreateInput {
  code: string
  name: string
}

export interface ProcedureUpdateInput {
  name: string
}
