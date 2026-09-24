import { z } from 'zod';
import { PAGINATION } from '../../config/constants';

/**
 * Piezas de validacion compartidas por los CRUD de datos HIS (TC1-TC5): ids
 * (claves naturales del HIS, no UUID), paginacion por cursor entero (keyset
 * sobre una PK `Int`, no `Uuid` como el resto de la API) y los dos formatos de
 * fecha que trae el HIS por API (con desfase horario explicito o solo el dia).
 */

/** Los ids de los recursos HIS son enteros (`OidIngreso`, `IdPaciente`...), no UUID. */
export const hisIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * Paginacion por cursor ENTERO (keyset sobre una PK `Int`). A proposito SIN
 * `.strict()`: cada listado la extiende con sus propios filtros indexados
 * (`.extend({...}).strict()`), igual que `periodoQuerySchema`.
 */
export const cursorEnteroQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
});

/**
 * Fecha+hora con desfase EXPLICITO (`2026-05-01T08:00:00-05:00`), tal y como
 * las escrituras de la API deben mandarlas: a diferencia del HIS de origen
 * (hora local de Colombia sin zona, asumida `-05:00` por el importador), aqui
 * el desfase lo declara quien escribe, no se asume.
 */
export const fechaHoraConDesfase = z
  .string()
  .datetime({ offset: true, message: 'Formato esperado: 2026-05-01T08:00:00-05:00 (con desfase horario).' })
  .transform((valor) => new Date(valor));

const RE_FECHA_SIMPLE = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha sin hora (`YYYY-MM-DD`), como `FechaNacimiento`: medianoche UTC. */
export const fechaSimple = z
  .string()
  .regex(RE_FECHA_SIMPLE, 'Formato esperado: YYYY-MM-DD.')
  .transform((valor) => new Date(`${valor}T00:00:00.000Z`));

/**
 * Codigo HIS (procedimiento, medicamento...): se normaliza a mayusculas antes
 * de validar el formato, igual que hace el importador con sus catalogos
 * derivados (`Procedure`/`Medication`).
 */
export const codigoHis = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{3,20}$/, 'Codigo invalido: 3 a 20 caracteres alfanumericos.');

export type HisIdParam = z.infer<typeof hisIdParamSchema>;
export type CursorEnteroQuery = z.infer<typeof cursorEnteroQuerySchema>;
