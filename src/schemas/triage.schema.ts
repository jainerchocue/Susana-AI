import { z } from 'zod'

const sharedFields = {
  triagedAt: z.string().min(1, 'La fecha del triage es obligatoria'),
  systolic: z.string(),
  diastolic: z.string(),
  heartRate: z.string(),
  respiratoryRate: z.string(),
  temperature: z.string(),
  patientId: z.string(),
  code: z.string().min(1, 'Obligatorio').max(20),
  classification: z.string().min(1, 'Obligatorio').max(200),
  level: z.string(),
}

export const triageCreateSchema = z.object({
  id: z.number().int().positive('Debe ser mayor a 0'),
  ...sharedFields,
})

export const triageUpdateSchema = z.object(sharedFields)

export type TriageCreateFormValues = z.infer<typeof triageCreateSchema>
export type TriageUpdateFormValues = z.infer<typeof triageUpdateSchema>
