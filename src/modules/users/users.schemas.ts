import { z } from 'zod';
import { UserStatus } from '@prisma/client';
import { PASSWORD_POLICY, esPasswordComun } from '../../core/security/password';
import { emailSchema, searchSchema, urlSegura, uuidSchema } from '../../core/http/schemas';
import { PAGINATION } from '../../config/constants';

export const idParamSchema = z.object({ id: uuidSchema });

export const listUsersQuerySchema = z
  .object({
    // Paginacion por cursor: coste constante con la profundidad (A-13).
    cursor: uuidSchema.optional(),
    // `page` se mantiene para paneles internos con pocas paginas.
    page: z.coerce.number().int().min(1).max(1_000).optional(),
    limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
    search: searchSchema.optional(),
    status: z.nativeEnum(UserStatus).optional(),
    role: z.string().trim().min(1).max(50).optional(),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

/**
 * Campos que cualquiera puede editar de SI MISMO.
 * Se define aparte y NO se reutiliza en el schema de administrador: compartirlo
 * fue lo que permitio que un usuario se cambiara su propio `status` (A-01).
 *
 * Better Auth tambien lo impide por su lado (`status` es un additionalField con
 * `input: false`), pero este modulo escribe por Prisma directamente: la defensa
 * tiene que estar en los dos sitios.
 */
const perfilPropio = {
  name: z.string().trim().min(1).max(120),
  image: urlSegura.nullable(),
};

export const updateMeSchema = z
  .object(perfilPropio)
  .partial()
  // .strict() convierte el descarte silencioso de Zod en un 422 explicito:
  // el cliente se entera de que envio un campo que no le corresponde.
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Envia al menos un campo.' });

/** Campos que un ADMINISTRADOR puede editar de otro usuario. */
export const updateUserSchema = z
  .object({ ...perfilPropio, status: z.nativeEnum(UserStatus) })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Envia al menos un campo.' });

export const createUserSchema = z
  .object({
    email: emailSchema,
    password: z
      .string()
      .min(PASSWORD_POLICY.minLength, PASSWORD_POLICY.message)
      .max(PASSWORD_POLICY.maxLength)
      .regex(PASSWORD_POLICY.regex, PASSWORD_POLICY.message)
      .refine((v) => !esPasswordComun(v), { message: 'Contraseña demasiado comun.' }),
    name: z.string().trim().min(1).max(120),
    roles: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  })
  .strict()
  // La contraseña no debe contener el correo: es lo primero que prueba un atacante.
  .refine((v) => !v.password.toLowerCase().includes(v.email.split('@')[0]!.toLowerCase()), {
    message: 'La contraseña no puede contener el nombre de usuario.',
    path: ['password'],
  });

/** Reemplaza el set completo de roles del usuario (no es incremental). */
export const setUserRolesSchema = z
  .object({ roles: z.array(z.string().trim().min(1).max(50)).max(20) })
  .strict();

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
