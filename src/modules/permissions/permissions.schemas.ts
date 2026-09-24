import { z } from 'zod';

/**
 * Solo esquemas de RESPUESTA (documentacion OpenAPI, TC0): el modulo no tiene
 * entrada que validar (un unico `GET /permissions` sin params ni query), asi
 * que hasta ahora no necesitaba este archivo. Forma exacta de
 * `listarAgrupados()` (permissions.service.ts).
 */
export const permissionItemResponseSchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  group: z.string(),
  description: z.string().nullable(),
});

export const permissionGroupResponseSchema = z.object({
  group: z.string(),
  permissions: z.array(permissionItemResponseSchema),
});

export const permissionsListResponseSchema = z.object({
  total: z.number().int(),
  groups: z.array(permissionGroupResponseSchema),
});
