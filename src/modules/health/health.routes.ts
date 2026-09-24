import { Router } from 'express';
import { prisma } from '../../core/db/prisma';
import { pingRedis } from '../../core/cache/redis';
import { pingAgente } from '../../core/agent/client';
import { hashesEnVuelo } from '../../core/security/password';
import { fail, ok } from '../../core/http/api-response';
import { ErrorCode, HttpStatus } from '../../core/http/http-status';
import { env } from '../../config/env';

const router = Router();

/**
 * Liveness: ¿el proceso responde? Debe ser barato y NO tocar dependencias:
 * si un liveness falla porque la BD esta caida, Kubernetes reinicia pods que
 * estaban perfectamente sanos y empeora el incidente.
 */
router.get('/', (_req, res) => ok(res, { status: 'ok', uptime: Math.floor(process.uptime()) }));

/** Readiness: ¿puede atender trafico? Este si comprueba dependencias. */
router.get('/ready', async (_req, res) => {
  const checks: Record<string, string> = {};
  let listo = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'up';
  } catch {
    checks.database = 'down';
    listo = false;
  }

  if (env.REDIS_URL) {
    const vivo = await pingRedis();
    checks.redis = vivo ? 'up' : 'down';
    if (!vivo) listo = false;
  } else {
    checks.redis = 'no configurado';
  }

  // Saturacion del hashing: si esta al limite, mejor que el balanceador
  // deje de mandar trafico a esta instancia antes de que empiece a dar 503.
  const enVuelo = hashesEnVuelo();
  checks.passwordHashing = `${enVuelo}/${env.PASSWORD_HASH_CONCURRENCY}`;

  // El agente es una dependencia OPCIONAL: si esta caido, el resto de la API
  // sigue sirviendo trafico (no toca `listo`). Solo baja el estado a 'degraded'.
  const agente = await pingAgente();
  checks.agent = agente;

  if (!listo) {
    return fail(res, HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.INTERNAL_ERROR, 'Dependencias no disponibles.', undefined, {
      checks,
    });
  }
  return ok(res, { status: agente === 'down' ? 'degraded' : 'ready', checks });
});

/** Startup probe: mismo criterio que readiness, con nombre explicito para K8s. */
router.get('/startup', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return ok(res, { status: 'started' });
  } catch {
    return fail(res, HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.INTERNAL_ERROR, 'Arrancando.');
  }
});

export default router;
