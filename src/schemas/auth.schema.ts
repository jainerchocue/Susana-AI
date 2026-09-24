import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().min(1, 'El correo es obligatorio').email('Correo electrónico inválido'),
  password: z.string().min(1, 'La contraseña es obligatoria').min(6, 'Mínimo 6 caracteres'),
})

export type LoginFormValues = z.infer<typeof loginSchema>
