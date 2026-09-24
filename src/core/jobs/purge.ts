import { prisma } from '../db/prisma';
import { env } from '../../config/env';
import { logger } from '../logger';

/**
 * Purga de sesiones y verificaciones caducadas.
 *
 * Sin esto, `sessions` crece de forma monotona: en la auditoria, el 50% de las
 * filas era basura tras minutos de uso (A-06). A 1M de usuarios activos son
 * decenas de millones de filas muertas y sus indices.
 *
 * Better Auth BORRA la sesion al cerrarla en vez de marcarla revocada, asi que
 * aqui solo queda barrer lo caducado (antes tambien habia que barrer revocadas).
 *
 * Se borra por lotes con pausa entre ellos: un DELETE masivo bloquearia la
 * tabla y competiria con el trafico real.
 */
const LOTE = 5_000;
const PAUSA_MS = 100;

async function purgarPorLotes(borrarLote: () => Promise<number>): Promise<number> {
  let total = 0;
  let borradas: number;
  do {
    borradas = await borrarLote();
    total += borradas;
    if (borradas > 0) await new Promise((r) => setTimeout(r, PAUSA_MS));
  } while (borradas >= LOTE);
  return total;
}

export async function purgarSesiones(): Promise<number> {
  const corte = new Date(Date.now() - env.PURGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return purgarPorLotes(async () => {
    // ctid + LIMIT: borra un lote acotado sin escanear la tabla entera.
    const filas = await prisma.$executeRaw`
      DELETE FROM sessions
      WHERE ctid IN (
        SELECT ctid FROM sessions
        WHERE "expiresAt" < ${corte}
        LIMIT ${LOTE}
      )`;
    return filas;
  });
}

export async function purgarVerificaciones(): Promise<number> {
  const corte = new Date(Date.now() - env.PURGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return purgarPorLotes(async () => {
    const filas = await prisma.$executeRaw`
      DELETE FROM verifications
      WHERE ctid IN (
        SELECT ctid FROM verifications
        WHERE "expiresAt" < ${corte}
        LIMIT ${LOTE}
      )`;
    return filas;
  });
}

export async function purgar(): Promise<{ sesiones: number; verificaciones: number }> {
  const sesiones = await purgarSesiones();
  const verificaciones = await purgarVerificaciones();
  if (sesiones + verificaciones > 0) logger.info({ sesiones, verificaciones }, 'Purga completada');
  return { sesiones, verificaciones };
}

/**
 * ponytail: setInterval en proceso. Con varias replicas todas purgan a la vez,
 * lo cual es idempotente pero desperdicia E/S. Con >3 replicas, mover a un cron
 * externo que llame a `npm run db:purge` y poner PURGE_ENABLED=false.
 */
export function programarPurga(): NodeJS.Timeout | null {
  if (!env.PURGE_ENABLED) return null;

  const intervalo = env.PURGE_INTERVAL_MINUTES * 60_000;
  const timer = setInterval(() => {
    purgar().catch((err: unknown) => { logger.error({ err }, 'Fallo la purga programada'); });
  }, intervalo);

  timer.unref(); // no impide que el proceso termine
  logger.info({ cadaMinutos: env.PURGE_INTERVAL_MINUTES }, 'Purga programada');
  return timer;
}
