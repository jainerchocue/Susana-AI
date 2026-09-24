import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { AppError } from '../../core/http/errors';
import { ErrorCode } from '../../core/http/http-status';
import { AUDIT, auditar, type RequestMeta } from '../../core/audit/audit';
import type { Actor } from '../../core/rbac/guards';
import { preguntarAgente } from '../../core/agent/client';
import { datasetsPara, describirParaAgente } from './assistant.catalog';
import { emitirTicket, guardarResultado, leerResultados, revocarTicket, usarTicket } from './assistant.tickets';
import { ejecutarConsulta, validarConsulta, type ResultadoConsulta } from './assistant.query';
import type { AskInput, InternalQueryInput, QuerySpec } from './assistant.schemas';

/**
 * Orquesta el flujo completo: emite el ticket, le pasa a Python un catalogo
 * puramente logico, y al terminar devuelve a React SOLO lo que Node ejecuto
 * (las filas que Python "dice" que obtuvo no importan y no se usan).
 */

export interface RespuestaAsistente {
  status: 'ok' | 'cannot_answer';
  answer: string;
  queries: Array<{ query: QuerySpec } & ResultadoConsulta>;
}

export async function preguntar(
  input: AskInput,
  actor: Actor,
  avanzado: boolean,
  meta: RequestMeta,
): Promise<RespuestaAsistente> {
  const datasets = datasetsPara(actor.permissions);
  if (datasets.length === 0) {
    throw AppError.forbidden(
      'No tienes acceso a ningun dataset del asistente.',
      ErrorCode.INSUFFICIENT_PERMISSIONS,
    );
  }

  const maxQueries = avanzado ? env.AGENT_MAX_QUERIES_ADVANCED : env.AGENT_MAX_QUERIES_BASIC;
  const requestId = meta.requestId ?? randomUUID();

  const ticket = await emitirTicket({
    userId: actor.id,
    permissions: [...actor.permissions],
    requestId,
    maxQueries,
    maxRows: env.AGENT_MAX_ROWS,
  });

  try {
    const respuesta = await preguntarAgente({
      question: input.question,
      ticket,
      catalog: describirParaAgente(datasets),
      limits: { maxQueries, maxRows: env.AGENT_MAX_ROWS },
      requestId,
    });

    const queries = await leerResultados(ticket);

    await auditar({
      action: AUDIT.asistenteConsulta,
      actorId: actor.id,
      targetType: 'assistant',
      metadata: {
        question: input.question.slice(0, 500),
        status: respuesta.status,
        datasets: datasets.map((d) => d.key),
        nQueries: queries.length,
        nRows: queries.reduce((acc, q) => acc + q.rowCount, 0),
      },
      ...meta,
    });

    return { status: respuesta.status, answer: respuesta.answer, queries };
  } catch (error) {
    const code = error instanceof AppError ? error.code : ErrorCode.INTERNAL_ERROR;
    await auditar({
      action: AUDIT.asistenteRechazo,
      actorId: actor.id,
      targetType: 'assistant',
      metadata: { code },
      ...meta,
    });
    throw error;
  } finally {
    // El ticket no sobrevive a la respuesta: cerrar la puerta pase lo que pase.
    await revocarTicket(ticket);
  }
}

/**
 * Llamada por el puerto interno (`assistant.internal.ts`), nunca por el
 * publico. El actor no viene de `req.auth`: viene de lo que el TICKET dice del
 * usuario que origino la pregunta (`usarTicket`), que es lo unico que Python
 * puede demostrar que conoce.
 */
export async function consultaInterna(input: InternalQueryInput): Promise<ResultadoConsulta> {
  const t = await usarTicket(input.ticket);
  const permisos = new Set(t.permissions);
  const datasets = datasetsPara(permisos);

  let validada;
  try {
    validada = validarConsulta(input.query, datasets, t.maxRows);
  } catch (error) {
    await auditar({
      action: AUDIT.agenteDenegado,
      actorId: t.userId,
      targetType: 'assistant',
      metadata: { requestId: t.requestId, dataset: input.query.dataset },
    });
    throw error;
  }

  const resultado = await ejecutarConsulta(validada, permisos);
  await guardarResultado(input.ticket, { query: input.query, ...resultado });

  await auditar({
    action: AUDIT.agenteConsulta,
    actorId: t.userId,
    targetType: 'assistant',
    metadata: { dataset: validada.dataset.key, rowCount: resultado.rowCount, requestId: t.requestId },
  });

  return resultado;
}
