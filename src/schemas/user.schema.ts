import { z } from 'zod'

export const userCreateSchema = z.object({
  email: z.string().min(1, 'Obligatorio').email('Correo electrónico inválido'),
  password: z.string().min(12, 'Mínimo 12 caracteres').max(128),
  name: z.string().min(1, 'Obligatorio').max(120),
  roles: z.array(z.string()),
})

export const userUpdateSchema = z.object({
  name: z.string().min(1, 'Obligatorio').max(120),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']),
})

export type UserCreateFormValues = z.infer<typeof userCreateSchema>
export type UserUpdateFormValues = z.infer<typeof userUpdateSchema>
