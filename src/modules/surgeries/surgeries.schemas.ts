import { z } from 'zod';

/**
 * `ProgramacionCirugia` no trae fecha en el HIS (B0): ni el resumen ni el CSV
 * aceptan un periodo que acotar. El esquema vacio y `.strict()` no valida
 * nada por si mismo; existe para que un query param desconocido responda 422
 * en vez de ignorarse en silencio (CLAUDE.md §15: ".strict() en los schemas").
 */
export const emptyQuerySchema = z.object({}).strict();
