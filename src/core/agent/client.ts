import { z } from 'zod';
import { env } from '../../config/env';
import { AppError } from '../http/errors';
import { logger } from '../logger';

/**
 * Cliente HTTP hacia el agente Python. Generico: no importa nada de
 * `modules/` (CLAUDE.md §1, `core` no conoce el negocio). El agente no tiene
 * autoridad: solo recibe un catalogo LOGICO (sin nombres reales de tabla o
 * columna) y devuelve texto; los datos que el usuario ve los ejecuta Node.
 */

export interface AgentCatalogEntry {
  dataset: string;
  description: string;
  dimensions: { name: string; type: 'string' | 'number' | 'date'; description: string; values?: string[] }[];
  measures: { name: string; description: string }[];
}

/**
 * Contexto temporal: `referenceDate` es el "hoy" de los datos (ultimo ingreso
 * importado), para que "hoy", "esta semana" o "este mes" signifiquen lo mismo
 * en el chat que en el panel; `dataStart`, el primero. Nulos si no hay datos
 * HIS importados.
 */
export interface AgentContext {
  referenceDate: string | null;
  /** Primer ingreso importado: el agente no cuenta como completo un periodo que empieza antes. */
  dataStart: string | null;
  timezone: string;
}

export interface AgentAskInput {
  question: string;
  ticket: string;
  catalog: AgentCatalogEntry[];
  limits: { maxQueries: number; maxRows: number };
  context: AgentContext;
  requestId: string;
}

export interface AgentAnswer {
  status: 'ok' | 'cannot_answer';
  answer: string;
  /** Tabla/grafica sugerida. SIN validar aqui: el modulo del asistente la valida contra lo que Node ejecuto. */
  visual?: unknown;
}

/** El cuerpo que devuelve Python es texto NO confiable: se valida con Zod. */
const respuestaAgenteSchema = z.object({
  status: z.enum(['ok', 'cannot_answer']),
  answer: z.string().max(4000),
  // Opcional y laxo a proposito: una especificacion visual invalida se descarta
  // mas adelante, no debe convertir una respuesta valida en un 502.
  visual: z.unknown().optional(),
});

/**
 * Pide al agente que proponga consultas para responder `question`.
 *
 * Sin AGENT_URL/AGENT_API_KEY, timeout o error de red -> `agentUnavailable`
 * (503): Python no respondio. Un HTTP no-2xx o un cuerpo que no pasa Zod ->
 * `agentError` (502): Python respondio pero con algo que no podemos usar.
 * Nunca se loguea el cuerpo de la respuesta: es texto de un tercero.
 */
export async function preguntarAgente(input: AgentAskInput): Promise<AgentAnswer> {
  if (!env.AGENT_URL || !env.AGENT_API_KEY) throw AppError.agentUnavailable();

  let respuesta: Response;
  try {
    respuesta = await fetch(`${env.AGENT_URL}/v1/ask`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-key': env.AGENT_API_KEY,
        'x-request-id': input.requestId,
      },
      body: JSON.stringify({
        question: input.question,
        ticket: input.ticket,
        catalog: input.catalog,
        limits: input.limits,
        context: input.context,
      }),
      signal: AbortSignal.timeout(env.AGENT_TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn({ err: error }, 'El asistente no respondio');
    throw AppError.agentUnavailable();
  }

  if (!respuesta.ok) throw AppError.agentError();

  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch {
    throw AppError.agentError();
  }

  const parseado = respuestaAgenteSchema.safeParse(cuerpo);
  if (!parseado.success) throw AppError.agentError();

  return parseado.data;
}

/** Liveness del agente para /health/ready. Timeout corto: no debe frenar la probe. */
export async function pingAgente(): Promise<'up' | 'down' | 'no configurado'> {
  if (!env.AGENT_URL) return 'no configurado';
  try {
    const respuesta = await fetch(`${env.AGENT_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return respuesta.ok ? 'up' : 'down';
  } catch {
    return 'down';
  }
}
