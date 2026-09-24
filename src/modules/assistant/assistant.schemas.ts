import { z } from 'zod';

/**
 * DSL que el agente Python propone y Node valida. Todo `.strict()`: un campo
 * desconocido debe fallar, no descartarse en silencio (CLAUDE.md, tabla de
 * "lo que no se puede tocar").
 *
 * `campo` es la unica forma que puede tomar un identificador logico (dataset,
 * dimension, medida): minusculas, digitos y guion bajo, sin comillas ni punto y
 * coma. Es la primera barrera contra la inyeccion, antes incluso de mirar el
 * catalogo.
 */
const campo = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);

export const querySpecSchema = z
  .object({
    dataset: campo,
    metrics: z
      .array(
        z
          .object({
            agg: z.enum(['count', 'count_distinct', 'sum', 'avg', 'min', 'max']),
            field: campo.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    groupBy: z
      .array(z.object({ field: campo, grain: z.enum(['day', 'week', 'month', 'year']).optional() }).strict())
      .max(3)
      .default([]),
    filters: z
      .array(
        z
          .object({
            field: campo,
            op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'between', 'contains']),
            value: z.union([
              z.string().max(200),
              z.number().finite(),
              z.boolean(),
              z.array(z.union([z.string().max(200), z.number().finite()])).min(1).max(50),
            ]),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    orderBy: z
      .array(
        z
          .object({
            ref: z.string().regex(/^(metric:[0-4]|[a-z][a-z0-9_]{0,62})$/),
            dir: z.enum(['asc', 'desc']).default('desc'),
          })
          .strict(),
      )
      .max(3)
      .default([]),
    limit: z.number().int().min(1).max(1000).default(100),
  })
  .strict();

/** Pregunta en lenguaje natural que llega desde React. */
export const askSchema = z.object({ question: z.string().trim().min(3).max(500) }).strict();

/** Lo que Python manda al puerto interno: el ticket y UNA consulta del DSL. */
export const internalQuerySchema = z
  .object({
    ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    query: querySpecSchema,
  })
  .strict();

export type QuerySpec = z.infer<typeof querySpecSchema>;
export type AskInput = z.infer<typeof askSchema>;
export type InternalQueryInput = z.infer<typeof internalQuerySchema>;

// ─── Esquemas de RESPUESTA (documentacion OpenAPI, TC0) ────────────────────
// Forma exacta de `RespuestaAsistente` (assistant.service.ts): una fila por
// consulta que NODE ejecuto (nunca lo que Python "dice" que obtuvo).
const filaResultadoSchema = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]));

const consultaEjecutadaResponseSchema = z.object({
  query: querySpecSchema,
  columns: z.array(z.string()),
  rows: z.array(filaResultadoSchema),
  rowCount: z.number().int(),
  truncated: z.boolean(),
});

/**
 * Tabla/grafica sugerida por el agente para la respuesta. NO lleva datos: el
 * frontend los toma de `queries[queryIndex].rows` (lo que Node ejecuto). La
 * unica excepcion es `projection`: valores proyectados por el agente, que se
 * dibujan aparte y rotulados como proyeccion. Todo `.strict()` y acotado: es
 * texto de un tercero que termina en la UI.
 */
const columnaResultado = z.string().regex(/^[a-z][a-z0-9_]{0,80}$/);

export const visualSchema = z
  .object({
    type: z.enum(['kpi', 'bar', 'line', 'table']),
    title: z.string().min(1).max(120),
    subtitle: z.string().max(240).optional(),
    queryIndex: z.number().int().min(0).max(9),
    x: columnaResultado.optional(),
    xLabel: z.string().max(80).optional(),
    grain: z.enum(['day', 'week', 'month', 'year']).optional(),
    fillMissing: z.boolean().optional(),
    columns: z
      .array(
        z
          .object({
            key: columnaResultado,
            label: z.string().min(1).max(80),
            unit: z.string().max(16).optional(),
            decimals: z.number().int().min(0).max(2).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    valueLabels: z
      .record(z.string().max(200), z.string().max(160))
      .refine((m) => Object.keys(m).length <= 200, 'Demasiadas etiquetas.')
      .optional(),
    omit: z.array(z.string().max(64)).max(10).optional(),
    projection: z
      .object({
        label: z.string().min(1).max(80),
        points: z
          .array(z.object({ x: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), y: z.number().finite() }).strict())
          .min(1)
          .max(31),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Visual = z.infer<typeof visualSchema>;

export const assistantResponseSchema = z.object({
  status: z.enum(['ok', 'cannot_answer']),
  answer: z.string(),
  queries: z.array(consultaEjecutadaResponseSchema),
  visual: visualSchema.nullable(),
});
