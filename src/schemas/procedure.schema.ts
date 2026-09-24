import { z } from 'zod'

export const procedureCreateSchema = z.object({
  code: z.string().min(1, 'El código es obligatorio').max(20, 'Máximo 20 caracteres'),
  name: z.string().min(1, 'El nombre es obligatorio').max(255, 'Máximo 255 caracteres'),
})

export const procedureUpdateSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(255, 'Máximo 255 caracteres'),
})

export type ProcedureCreateFormValues = z.infer<typeof procedureCreateSchema>
export type ProcedureUpdateFormValues = z.infer<typeof procedureUpdateSchema>
