import type { z } from 'zod';
import { periodoQuerySchema } from '../his/his.periodo';

/**
 * Los 4 endpoints del panel solo aceptan el periodo compartido (`desde`/
 * `hasta`), sin campos propios: `.extend({})` la convierte en `.strict()`
 * (CLAUDE.md §15: campos desconocidos deben rechazarse, no descartarse en
 * silencio).
 */
export const dashboardQuerySchema = periodoQuerySchema.extend({}).strict();

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
