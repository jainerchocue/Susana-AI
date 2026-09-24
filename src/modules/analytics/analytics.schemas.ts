import { z } from 'zod';
import { periodoQuerySchema } from '../his/his.periodo';

/** Los endpoints de analitica (y sus export) solo aceptan el periodo compartido. */
export const analyticsQuerySchema = periodoQuerySchema.extend({}).strict();

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

// ─── Esquemas de RESPUESTA (documentacion OpenAPI, TC3) ────────────────────
// Forma exacta de lo que arma `analytics.controller.ts` a partir de
// `analytics.service.ts`/`wait-time.service.ts`: mismos nombres de campo, en
// el mismo orden logico que el controlador.

const periodoResponseSchema = z.object({ desde: z.string().datetime(), hasta: z.string().datetime() });

export const analyticsServicesResponseSchema = z.object({
  periodo: periodoResponseSchema,
  porAreaEspecialidad: z.array(
    z.object({ area: z.string(), specialty: z.string(), lines: z.number().int(), quantity: z.number().int() }),
  ),
  topProcedimientos: z.array(
    z.object({ code: z.string(), name: z.string().nullable(), quantity: z.number().int() }),
  ),
  serieDiaria: z.array(z.object({ day: z.string(), lines: z.number().int(), quantity: z.number().int() })),
});

export const analyticsTriageResponseSchema = z.object({
  periodo: periodoResponseSchema,
  porNivel: z.array(z.object({ level: z.number().int().nullable(), n: z.number().int() })),
  porClasificacion: z.array(z.object({ classification: z.string(), n: z.number().int() })),
  perfilHorario: z.array(z.object({ hour: z.number().int(), n: z.number().int() })),
  esperaPorNivel: z.array(
    z.object({
      level: z.number().int(),
      n: z.number().int(),
      p50: z.number(),
      p90: z.number(),
      avg: z.number(),
    }),
  ),
});
