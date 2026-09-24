import { z } from 'zod';

/**
 * Solo esquemas de RESPUESTA (documentacion OpenAPI, TC0): las 3 sondas no
 * validan entrada (sin params, query ni body). Formas exactas de
 * `health.routes.ts` en su rama de exito (200); el 503 lo documenta el sobre
 * de error generico, no estos esquemas.
 */
export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
  uptime: z.number().int(),
});

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'degraded']),
  checks: z.record(z.string()),
});

export const startupResponseSchema = z.object({
  status: z.literal('started'),
});
