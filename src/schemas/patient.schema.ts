import { z } from 'zod'

export const patientCreateSchema = z.object({
  id: z.number().int('Debe ser un número entero').positive('Debe ser mayor a 0'),
  documentType: z.string().min(1, 'Obligatorio').max(20),
  birthDate: z.string().min(1, 'La fecha de nacimiento es obligatoria'),
  sex: z.string().min(1, 'Obligatorio').max(20),
  insurer: z.string().min(1, 'Obligatorio').max(120),
  regime: z.string().min(1, 'Obligatorio').max(60),
  department: z.string().min(1, 'Obligatorio').max(80),
  municipality: z.string().min(1, 'Obligatorio').max(80),
  zone: z.string().min(1, 'Obligatorio').max(20),
})

/** birthDate nunca se lee de vuelta (GET nunca la incluye), así que no se ofrece para editar. */
export const patientUpdateSchema = patientCreateSchema.omit({ id: true, birthDate: true })

export type PatientCreateFormValues = z.infer<typeof patientCreateSchema>
export type PatientUpdateFormValues = z.infer<typeof patientUpdateSchema>
