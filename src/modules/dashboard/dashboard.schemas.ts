import { z } from 'zod';
import { periodoQuerySchema } from '../his/his.periodo';

/**
 * Los 4 endpoints del panel solo aceptan el periodo compartido (`desde`/
 * `hasta`), sin campos propios: `.extend({})` la convierte en `.strict()`
 * (CLAUDE.md §15: campos desconocidos deben rechazarse, no descartarse en
 * silencio).
 */
export const dashboardQuerySchema = periodoQuerySchema.extend({}).strict();

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

// ─── Esquemas de RESPUESTA (documentacion OpenAPI, TC2) ────────────────────
// Forma exacta de lo que arma `dashboard.controller.ts` en cada uno de los 4
// endpoints. `numeroOInsuficiente` es el union `number | 'insufficient_data'`
// que B0 documenta como el UNICO escape del contrato numerico (sin fecha de
// egreso ni capacidad fisica, algunos cocientes no se pueden calcular).
const numeroOInsuficiente = z.union([z.number(), z.literal('insufficient_data')]);

const periodoIsoSchema = z.object({ desde: z.string().datetime(), hasta: z.string().datetime() });

const alertasPorSeveridadSchema = z.object({ WARNING: z.number().int(), CRITICAL: z.number().int() });

export const dashboardSummaryResponseSchema = z.object({
  periodo: periodoIsoSchema,
  datosHasta: z.string().datetime(),
  admissions: z.object({
    last24h: z.number().int(),
    last7d: z.number().int(),
    periodo: z.number().int(),
  }),
  occupancy: z.object({
    census: z.number().int(),
    physicalBeds: z.number().int(),
    occupancyPct: numeroOInsuficiente,
    metodo: z.literal('censo_estimado_ultima_actividad'),
  }),
  waitTimeP50Minutes: numeroOInsuficiente,
  // Solo aparece si el actor tiene algun ambito visible (alertasAbiertasPorSeveridad, dashboard.controller.ts).
  alerts: alertasPorSeveridadSchema.optional(),
});

const ocupacionUnidadSchema = z.object({
  unit: z.string(),
  physicalBeds: z.number().int(),
  census: z.number().int(),
  occupancyPct: numeroOInsuficiente,
  virtualCensus: z.number().int(),
});

const censoDiarioSchema = z.object({
  day: z.string(),
  census: z.number().int(),
  occupancyPct: numeroOInsuficiente,
});

export const dashboardOccupancyResponseSchema = z.object({
  periodo: periodoIsoSchema,
  datosHasta: z.string().datetime(),
  metodo: z.literal('censo_estimado_ultima_actividad'),
  porUnidad: z.array(ocupacionUnidadSchema),
  serieDiaria: z.array(censoDiarioSchema),
});

const esperaNivelSchema = z.object({
  level: z.number().int(),
  n: z.number().int(),
  p50: z.number(),
  p90: z.number(),
  avg: z.number(),
});

const p50DiarioSchema = z.object({
  day: z.string(),
  n: z.number().int(),
  p50: numeroOInsuficiente,
});

export const dashboardWaitTimesResponseSchema = z.object({
  periodo: periodoIsoSchema,
  porNivel: z.array(esperaNivelSchema),
  serieDiaria: z.array(p50DiarioSchema),
});

const ingresoPorDiaUnidadSchema = z.object({ day: z.string(), unit: z.string(), n: z.number().int() });
const ingresoPorViaSchema = z.object({ entryRoute: z.string(), n: z.number().int() });
const perfilHoraSchema = z.object({ hour: z.number().int(), n: z.number().int() });
const demandaUnidadSchema = z.object({
  unit: z.string(),
  last7: z.number().int(),
  prev7: z.number().int(),
  changePct: numeroOInsuficiente,
});

export const dashboardDemandResponseSchema = z.object({
  periodo: periodoIsoSchema,
  datosHasta: z.string().datetime(),
  porDiaYUnidad: z.array(ingresoPorDiaUnidadSchema),
  porViaIngreso: z.array(ingresoPorViaSchema),
  perfilHorario: z.array(perfilHoraSchema),
  cambioPorUnidad: z.array(demandaUnidadSchema),
});
