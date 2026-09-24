import { env } from '../../config/env';
import { logger } from '../../core/logger';
import { construirMetricas, METRICAS_EVALUADAS } from './alerts.metrics';
import { evaluarReglas } from './alerts.engine';
import { sincronizar } from './alerts.service';

/**
 * Job de evaluacion del motor de alertas (T11): mismo patron que
 * `core/jobs/purge.ts` (setInterval en proceso, `unref()` para no bloquear el
 * apagado). Se dispara al arrancar Y cada `ALERT_EVAL_INTERVAL_MINUTES`;
 * `POST /alerts/evaluate` llama a `evaluarAlertas()` directamente para
 * disparar una pasada a mano, fuera del calendario.
 */

export interface ResultadoEvaluacionAlertas {
  creadas: number;
  actualizadas: number;
  resueltas: number;
  evaluadoEn: string;
}

export async function evaluarAlertas(): Promise<ResultadoEvaluacionAlertas> {
  const puntos = await construirMetricas();
  const candidatos = evaluarReglas(puntos);
  const resultado = await sincronizar(candidatos, METRICAS_EVALUADAS);
  return { ...resultado, evaluadoEn: new Date().toISOString() };
}

/**
 * ponytail: igual que `programarPurga`, con varias replicas todas evaluan a la
 * vez (idempotente via `sincronizar`, pero E/S de mas). Con >3 replicas, mover
 * a un cron externo y ALERT_EVAL_ENABLED=false.
 */
export function programarEvaluacionAlertas(): NodeJS.Timeout | null {
  if (!env.ALERT_EVAL_ENABLED) return null;

  const ejecutar = () => {
    evaluarAlertas()
      .then((r) => logger.info(r, 'Evaluacion de alertas completada'))
      .catch((err: unknown) => { logger.error({ err }, 'Fallo la evaluacion de alertas'); });
  };

  ejecutar(); // al arrancar, sin esperar al primer intervalo.

  const intervalo = env.ALERT_EVAL_INTERVAL_MINUTES * 60_000;
  const timer = setInterval(ejecutar, intervalo);

  timer.unref(); // no impide que el proceso termine
  logger.info({ cadaMinutos: env.ALERT_EVAL_INTERVAL_MINUTES }, 'Evaluacion de alertas programada');
  return timer;
}
