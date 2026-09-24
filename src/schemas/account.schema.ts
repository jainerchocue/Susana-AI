import { z } from 'zod'

export const profileUpdateSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(120, 'Máximo 120 caracteres'),
})

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'La contraseña actual es obligatoria'),
    newPassword: z.string().min(12, 'Mínimo 12 caracteres').max(128),
    confirmPassword: z.string().min(1, 'Confirme la nueva contraseña'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  })

export type ProfileUpdateFormValues = z.infer<typeof profileUpdateSchema>
export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>
