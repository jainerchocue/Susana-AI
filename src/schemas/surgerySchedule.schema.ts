import { z } from 'zod'

const sharedFields = {
  scheduleNumber: z.string().min(1, 'Obligatorio').max(50),
  patientId: z.number().int().positive('Debe ser mayor a 0'),
  admissionId: z.string(),
  procedureCode: z.string().min(1, 'Obligatorio'),
}

export const surgeryScheduleCreateSchema = z.object(sharedFields)
export const surgeryScheduleUpdateSchema = z.object(sharedFields)

export type SurgeryScheduleFormValues = z.infer<typeof surgeryScheduleCreateSchema>
