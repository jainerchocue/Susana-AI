import Redis from 'ioredis';
import { env, isProd } from '../../config/env';
import { logger } from '../logger';

/**
 * Redis es opcional en desarrollo y obligatorio en produccion (lo valida
 * env.ts). Cuando no esta, `cache` degrada a un Map local: util para levantar
 * el proyecto sin infraestructura, inservible con mas de una instancia.
 */

let cliente: Redis | null = null;

if (env.REDIS_URL) {
  cliente = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false, // preferimos fallar rapido a acumular comandos
    lazyConnect: false,
    connectTimeout: 5_000,
    retryStrategy: (intentos) => Math.min(intentos * 200, 3_000),
  });

  cliente.on('error', (err) => { logger.error({ err }, 'Error de Redis'); });
  cliente.on('connect', () => { logger.info('Redis conectado'); });
} else if (isProd) {
  // Defensa en profundidad: env.ts ya lo impide, pero esto cubre un bypass.
  throw new Error('REDIS_URL es obligatoria en produccion.');
} else {
  logger.warn('Sin REDIS_URL: cache y rate limit en memoria (solo valido con UNA instancia).');
}

export const redis = cliente;

// ─────────────────────────────────────────────────────────────────────────────
// Fallback en memoria
// ─────────────────────────────────────────────────────────────────────────────

interface Entrada {
  valor: string;
  expiraEn: number;
}

const memoria = new Map<string, Entrada>();

function limpiarMemoria(): void {
  const ahora = Date.now();
  for (const [clave, e] of memoria) if (e.expiraEn <= ahora) memoria.delete(clave);
}

// Sin esto el Map crece indefinidamente. unref() no impide que el proceso salga.
if (!cliente) setInterval(limpiarMemoria, 60_000).unref();

/**
 * API minima de cache. A proposito no expone todo Redis: si un modulo necesita
 * estructuras avanzadas, que use `redis` directamente y asuma que puede ser null.
 */
export const cache = {
  async get(clave: string): Promise<string | null> {
    if (cliente) return cliente.get(clave);
    const e = memoria.get(clave);
    if (!e) return null;
    if (e.expiraEn <= Date.now()) {
      memoria.delete(clave);
      return null;
    }
    return e.valor;
  },

  async set(clave: string, valor: string, ttlSegundos: number): Promise<void> {
    if (cliente) {
      await cliente.set(clave, valor, 'EX', ttlSegundos);
      return;
    }
    memoria.set(clave, { valor, expiraEn: Date.now() + ttlSegundos * 1000 });
  },

  async del(clave: string): Promise<void> {
    if (cliente) {
      await cliente.del(clave);
      return;
    }
    memoria.delete(clave);
  },

  /** Devuelve el nuevo valor. Base de la invalidacion por version. */
  async incr(clave: string): Promise<number> {
    if (cliente) return cliente.incr(clave);
    const actual = Number((await this.get(clave)) ?? '0') + 1;
    // Sin TTL practico: la version debe sobrevivir al TTL de lo que invalida.
    memoria.set(clave, { valor: String(actual), expiraEn: Date.now() + 86_400_000 });
    return actual;
  },

  /** SET NX: true si la clave no existia. Base de la idempotencia y los locks. */
  async setNx(clave: string, valor: string, ttlSegundos: number): Promise<boolean> {
    if (cliente) return (await cliente.set(clave, valor, 'EX', ttlSegundos, 'NX')) === 'OK';
    if (await this.get(clave)) return false;
    await this.set(clave, valor, ttlSegundos);
    return true;
  },
};

export async function pingRedis(): Promise<boolean> {
  if (!cliente) return false;
  try {
    return (await cliente.ping()) === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  await cliente?.quit().catch(() => { cliente?.disconnect(); });
}
