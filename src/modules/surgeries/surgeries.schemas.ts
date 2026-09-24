import { z } from 'zod';

/**
 * `ProgramacionCirugia` no trae fecha en el HIS (B0): ni el resumen ni el CSV
 * aceptan un periodo que acotar. El esquema vacio y `.strict()` no valida
 * nada por si mismo; existe para que un query param desconocido responda 422
 * en vez de ignorarse en silencio (CLAUDE.md §15: ".strict() en los schemas").
 */
export const emptyQuerySchema = z.object({}).strict();

// ─── Esquema de RESPUESTA (documentacion OpenAPI, TC3) ─────────────────────
// Forma exacta de `SurgeriesSummary` (surgeries.service.ts#resumen). Los
// porcentajes son `number | 'insufficient_data'` (B0): sin verificables (todo
// 'desconocido'), no hay sobre que calcular un porcentaje.
const porcentajeOInsuficiente = z.union([z.number(), z.literal('insufficient_data')]);

export const surgeriesSummaryResponseSchema = z.object({
  totalSchedules: z.number().int(),
  distinctProcedures: z.number().int(),
  withAdmissionInExtract: z.object({ count: z.number().int(), pct: porcentajeOInsuficiente }),
  verifiable: z.object({
    total: z.number().int(),
    executed: z.number().int(),
    executedPct: porcentajeOInsuficiente,
    notExecuted: z.number().int(),
    notExecutedPct: porcentajeOInsuficiente,
  }),
  unknown: z.number().int(),
  topProcedures: z.array(
    z.object({ code: z.string(), name: z.string().nullable(), count: z.number().int() }),
  ),
  byUnit: z.array(z.object({ unit: z.string(), count: z.number().int() })),
});
