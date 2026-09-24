import { z } from 'zod';
import { prisma } from '../../core/db/prisma';
import { AppError } from '../../core/http/errors';
import { HttpStatus } from '../../core/http/http-status';

/**
 * Contrato compartido de "periodo" para toda consulta sobre datos HIS
 * (fase B: T8, T9, T10, T11 lo consumen). Vive aqui, en `modules/his`, y no en
 * `core/`, porque conoce el dominio del hospital (la tabla Admission).
 */

/** Colombia: UTC-5 fijo, sin horario de verano (B0). */
export const HIS_ZONA_HORARIA = 'America/Bogota';

const UN_DIA_MS = 24 * 60 * 60 * 1000;
const RANGO_MAXIMO_DIAS = 366;

/**
 * `desde`/`hasta` opcionales, coeridos a Date. A proposito SIN `.strict()` ni
 * `.refine()`: cada endpoint la compone con `.extend({...}).strict()` (T8), y
 * `.refine()` la convertiria en ZodEffects, que ya no admite `.extend()`. La
 * validacion semantica (orden, rango maximo) vive en `resolverPeriodo`, no aqui.
 */
export const periodoQuerySchema = z.object({
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});

export type PeriodoQuery = z.infer<typeof periodoQuerySchema>;

interface CachePeriodo {
  valor: Date;
  expiraEn: number;
}

let cache: CachePeriodo | null = null;
const CACHE_TTL_MS = 5 * 60_000;

/**
 * Fecha de referencia = max(admittedAt) de los datos HIS importados, NO
 * `now()`: los datos acaban en 2026-09-21 (B0). Cacheada 5 minutos en memoria:
 * es un MAX sobre 17.781 filas, barato pero innecesario en cada peticion.
 */
export async function fechaReferencia(): Promise<Date> {
  if (cache && cache.expiraEn > Date.now()) return cache.valor;

  const fila = await prisma.admission.aggregate({ _max: { admittedAt: true } });
  const maximo = fila._max.admittedAt;
  if (!maximo) {
    throw AppError.externalService('No hay datos HIS importados', HttpStatus.SERVICE_UNAVAILABLE);
  }

  cache = { valor: maximo, expiraEn: Date.now() + CACHE_TTL_MS };
  return maximo;
}

/**
 * Resuelve un periodo completo a partir de lo que el cliente mando (parcial o
 * vacio). `hasta` por defecto es la fecha de referencia; `desde` por defecto
 * son `diasPorDefecto` dias antes de `hasta`.
 */
export async function resolverPeriodo(
  q: { desde?: Date; hasta?: Date },
  diasPorDefecto = 30,
): Promise<{ desde: Date; hasta: Date }> {
  const referencia = await fechaReferencia();
  const hasta = q.hasta ?? referencia;
  const desde = q.desde ?? new Date(hasta.getTime() - diasPorDefecto * UN_DIA_MS);

  if (desde > hasta) {
    throw AppError.validation('El periodo no es valido.', [
      { field: 'desde', message: '"desde" debe ser anterior o igual a "hasta".' },
    ]);
  }

  if (hasta.getTime() - desde.getTime() > RANGO_MAXIMO_DIAS * UN_DIA_MS) {
    throw AppError.validation('El periodo no es valido.', [
      { field: 'hasta', message: `El rango no puede superar ${RANGO_MAXIMO_DIAS} dias.` },
    ]);
  }

  return { desde, hasta };
}
