import crypto from 'node:crypto';
import { env } from '../../config/env';
import { cache } from '../../core/cache/redis';
import { AppError } from '../../core/http/errors';
import { ErrorCode } from '../../core/http/http-status';
import type { QuerySpec } from './assistant.schemas';
import type { ResultadoConsulta } from './assistant.query';

/**
 * Ticket de un solo flujo pregunta-respuesta: liga las consultas que Python
 * propone al usuario que pregunto y le pone cupo. Vive en `cache` (Redis o
 * memoria); solo se guarda su HASH, nunca el valor en claro, igual que hace
 * Better Auth con sus propios tokens.
 */

export interface Ticket {
  userId: string;
  permissions: string[];
  requestId: string;
  maxQueries: number;
  maxRows: number;
}

interface TicketAlmacenado extends Ticket {
  usos: number;
  /** Epoch ms: el instante ABSOLUTO en el que el ticket caduca, fijado al emitirlo. */
  expiraEn: number;
}

type ResultadoGuardado = { query: QuerySpec } & ResultadoConsulta;

function claveTicket(ticket: string): string {
  const hash = crypto.createHash('sha256').update(ticket).digest('hex');
  return `agent:ticket:${hash}`;
}

function claveResultados(ticket: string): string {
  return `${claveTicket(ticket)}:resultados`;
}

/**
 * Segundos que quedan hasta `expiraEn`, o `null` si ya paso. Se usa para que
 * cada reescritura del registro en `cache` use el TTL RESTANTE, nunca el TTL
 * completo: reescribir con `AGENT_TICKET_TTL_SECONDS` en cada uso alargaba la
 * vida del ticket mas alla de su TTL nominal (hallazgo de la revision de
 * seguridad: un ticket usado justo antes de cada caducidad podia vivir
 * indefinidamente).
 */
function ttlRestante(expiraEn: number): number | null {
  const restanteMs = expiraEn - Date.now();
  return restanteMs > 0 ? Math.ceil(restanteMs / 1000) : null;
}

/** Emite el ticket con TTL `AGENT_TICKET_TTL_SECONDS`. Devuelve el valor EN CLARO (solo esta vez). */
export async function emitirTicket(t: Ticket): Promise<string> {
  const ticket = crypto.randomBytes(32).toString('base64url');
  const expiraEn = Date.now() + env.AGENT_TICKET_TTL_SECONDS * 1000;
  const almacenado: TicketAlmacenado = { ...t, usos: 0, expiraEn };
  await cache.set(claveTicket(ticket), JSON.stringify(almacenado), env.AGENT_TICKET_TTL_SECONDS);
  return ticket;
}

/**
 * Consume un uso del ticket. Inexistente o YA CADUCADO (segun `expiraEn`,
 * comprobado aqui de forma independiente de lo que diga el TTL del store)
 * -> 401. Cupo agotado -> 403 (el ticket sigue siendo valido, pero esta
 * operacion no).
 *
 * ponytail: el conteo es get+set, no atomico (el `incr` de `cache` no fija
 * TTL en el fallback en memoria). En el peor caso, dos peticiones simultaneas
 * con el mismo ticket dejan pasar UNA consulta de mas dentro del TTL de unos
 * segundos: aceptable para el MVP, revisar si el agente empieza a paralelizar
 * consultas del mismo ticket.
 */
export async function usarTicket(ticket: string): Promise<Ticket> {
  const clave = claveTicket(ticket);
  const crudo = await cache.get(clave);
  if (!crudo) throw AppError.unauthorized('Ticket invalido o caducado.', ErrorCode.TOKEN_INVALID);

  const almacenado = JSON.parse(crudo) as TicketAlmacenado;
  const restante = ttlRestante(almacenado.expiraEn);
  if (restante === null) throw AppError.unauthorized('Ticket invalido o caducado.', ErrorCode.TOKEN_INVALID);

  if (almacenado.usos >= almacenado.maxQueries) {
    throw AppError.forbidden('Se agoto el cupo de consultas de este ticket.');
  }

  almacenado.usos += 1;
  await cache.set(clave, JSON.stringify(almacenado), restante);

  const { userId, permissions, requestId, maxQueries, maxRows } = almacenado;
  return { userId, permissions, requestId, maxQueries, maxRows };
}

/** Acumula un resultado bajo el ticket, para que Node se los devuelva a React (nunca lo que Python "dice" que salio). */
export async function guardarResultado(ticket: string, r: ResultadoGuardado): Promise<void> {
  const crudo = await cache.get(claveTicket(ticket));
  if (!crudo) return; // el ticket ya no existe: no tiene sentido guardar nada bajo el

  const restante = ttlRestante((JSON.parse(crudo) as TicketAlmacenado).expiraEn);
  if (restante === null) return;

  const existentes = await leerResultados(ticket);
  existentes.push(r);
  // Mismo TTL restante que el ticket (nunca el TTL completo): ver `usarTicket`.
  await cache.set(claveResultados(ticket), JSON.stringify(existentes), restante);
}

export async function leerResultados(ticket: string): Promise<ResultadoGuardado[]> {
  const crudo = await cache.get(claveResultados(ticket));
  if (!crudo) return [];
  return JSON.parse(crudo) as ResultadoGuardado[];
}

/** Se llama siempre en el `finally` de `preguntar()`: el ticket no sobrevive a la respuesta. */
export async function revocarTicket(ticket: string): Promise<void> {
  await cache.del(claveTicket(ticket));
  await cache.del(claveResultados(ticket));
}
