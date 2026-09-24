import type { z } from 'zod';
import { periodoQuerySchema } from '../his/his.periodo';

/** Los endpoints de analitica (y sus export) solo aceptan el periodo compartido. */
export const analyticsQuerySchema = periodoQuerySchema.extend({}).strict();

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
