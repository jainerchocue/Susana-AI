import { z } from 'zod'

export const roleCreateSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres').max(50),
  description: z.string().max(255),
  permissions: z.array(z.string()),
})

export const roleUpdateSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres').max(50),
  description: z.string().max(255),
})

export type RoleCreateFormValues = z.infer<typeof roleCreateSchema>
export type RoleUpdateFormValues = z.infer<typeof roleUpdateSchema>
