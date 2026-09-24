import { z } from 'zod';
import { PAGINATION } from '../../config/constants';

const roleName = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(50)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Solo minusculas, numeros, guion y guion bajo.');

export const idParamSchema = z.object({ id: z.string().uuid('Identificador invalido.') });

export const listRolesQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(PAGINATION.defaultPage),
  limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
  search: z.string().trim().min(1).max(60).optional(),
});

export const createRoleSchema = z.strictObject({
  name: roleName,
  description: z.string().trim().max(255).optional(),
  permissions: z.array(z.string().trim().min(1)).default([]),
});

export const updateRoleSchema = z
  .object({
    name: roleName,
    description: z.string().trim().max(255).nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Envia al menos un campo.' });

/** Reemplaza el set completo de permisos del rol. */
export const setRolePermissionsSchema = z.strictObject({
  permissions: z.array(z.string().trim().min(1)).max(200),
});

export type ListRolesQuery = z.infer<typeof listRolesQuerySchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
