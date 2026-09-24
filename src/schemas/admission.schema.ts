import { z } from 'zod'

const sharedFields = {
  consecutive: z.number().int().nonnegative('Debe ser 0 o mayor'),
  patientId: z.number().int().positive('Debe ser mayor a 0'),
  admissionClass: z.string().min(1, 'Obligatorio').max(60),
  entryRoute: z.string().min(1, 'Obligatorio').max(60),
  riskType: z.string().min(1, 'Obligatorio').max(120),
  admittedAt: z.string().min(1, 'La fecha de ingreso es obligatoria'),
  hospitalizedAt: z.string(),
  triageId: z.string(),
  bedCode: z.string().min(1, 'Obligatorio').max(30),
  bedName: z.string().min(1, 'Obligatorio').max(120),
  unit: z.string().min(1, 'Obligatorio').max(80),
  subunit: z.string().min(1, 'Obligatorio').max(80),
  diagnosisCode: z.string().max(20),
  diagnosisName: z.string().max(200),
}

export const admissionCreateSchema = z.object({
  id: z.number().int().positive('Debe ser mayor a 0'),
  ...sharedFields,
})

export const admissionUpdateSchema = z.object(sharedFields)

export type AdmissionCreateFormValues = z.infer<typeof admissionCreateSchema>
export type AdmissionUpdateFormValues = z.infer<typeof admissionUpdateSchema>
