import { z } from 'zod'

const sharedFields = {
  code: z.string().min(1, 'Obligatorio'),
  procedureName: z.string(),
  quantity: z.number().int().nonnegative('Debe ser 0 o mayor'),
  providedAt: z.string().min(1, 'La fecha del servicio es obligatoria'),
  areaCode: z.string().min(1, 'Obligatorio').max(20),
  area: z.string().min(1, 'Obligatorio').max(120),
  specialty: z.string().min(1, 'Obligatorio').max(120),
}

export const serviceRecordCreateSchema = z.object({
  id: z.number().int().positive('Debe ser mayor a 0'),
  admissionId: z.number().int().positive('Debe ser mayor a 0'),
  ...sharedFields,
})

export const serviceRecordUpdateSchema = z.object(sharedFields)

export type ServiceRecordCreateFormValues = z.infer<typeof serviceRecordCreateSchema>
export type ServiceRecordUpdateFormValues = z.infer<typeof serviceRecordUpdateSchema>
