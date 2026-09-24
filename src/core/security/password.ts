import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../../config/env';
import { AppError } from '../http/errors';
import { ErrorCode, HttpStatus } from '../http/http-status';

const scrypt = promisify(crypto.scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

/**
 * Hashing de contraseñas con scrypt (aprobado por OWASP).
 *
 * Parametros calibrados tras la auditoria (C-03): N=2^15 con p=3 cuesta lo
 * mismo en CPU que N=2^16 con p=1 pero usa la MITAD de memoria (32MB vs 64MB).
 * El coste sigue siendo el recomendado por OWASP para scrypt.
 *
 * verify() lee N, r y p del hash almacenado, asi que los hashes creados con
 * los parametros antiguos siguen validandose sin migracion.
 */
const ALGO = 'scrypt';
const PARAMS = { N: 2 ** 15, r: 8, p: 3, maxmem: 128 * 2 ** 15 * 8 * 4 };
const KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * Semaforo. scrypt corre en el threadpool de libuv, compartido con fs y dns:
 * sin limite, un flood de logins congela el proceso entero, no solo el login.
 * Por encima del limite se responde 503 de inmediato en lugar de encolar.
 */
let enVuelo = 0;

async function conLimite<T>(fn: () => Promise<T>): Promise<T> {
  if (enVuelo >= env.PASSWORD_HASH_CONCURRENCY) {
    throw new AppError(
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.RATE_LIMITED,
      'Servicio de autenticacion saturado. Reintenta en unos segundos.',
    );
  }
  enVuelo += 1;
  try {
    return await fn();
  } finally {
    enVuelo -= 1;
  }
}

/** Observabilidad: lo expone /health/ready para detectar saturacion. */
export function hashesEnVuelo(): number {
  return enVuelo;
}

/** Formato: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPassword(plain: string): Promise<string> {
  return conLimite(async () => {
    const salt = crypto.randomBytes(SALT_BYTES);
    const derived = await scrypt(plain.normalize('NFKC'), salt, KEYLEN, PARAMS);
    return [ALGO, PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), derived.toString('base64')].join('$');
  });
}

export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  return conLimite(async () => {
    // Sin hash guardado (cuenta solo social): se hace el mismo trabajo para no
    // revelar por tiempo de respuesta si el usuario existe.
    if (!stored) {
      await scrypt('dummy', crypto.randomBytes(SALT_BYTES), KEYLEN, PARAMS);
      return false;
    }

    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== ALGO) return false;

    const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
    const N = Number(n);
    const R = Number(r);
    const P = Number(p);

    // Un hash manipulado con N absurdo agotaria la memoria del proceso.
    if (!Number.isSafeInteger(N) || N > 2 ** 20 || !Number.isSafeInteger(R) || !Number.isSafeInteger(P)) {
      return false;
    }

    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scrypt(plain.normalize('NFKC'), salt, expected.length, {
      N,
      r: R,
      p: P,
      maxmem: 128 * N * R * 4,
    });

    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  });
}

/** true si el hash usa parametros antiguos y conviene recalcularlo al entrar. */
export function necesitaRehash(stored: string | null): boolean {
  if (!stored) return false;
  const [algo, n, r, p] = stored.split('$');
  return algo !== ALGO || Number(n) !== PARAMS.N || Number(r) !== PARAMS.r || Number(p) !== PARAMS.p;
}

/** Requisitos minimos de una contraseña. Se usa desde los schemas de Zod. */
export const PASSWORD_POLICY = {
  minLength: 12,
  maxLength: 128,
  regex: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
  message: 'Debe tener al menos 12 caracteres, una minuscula, una mayuscula y un numero.',
} as const;

/**
 * Rechaza las contraseñas mas explotadas en credential stuffing.
 *
 * Ya NO es la defensa principal: el plugin `haveIBeenPwned` de Better Auth
 * consulta la API de k-anonimato real. Esto queda como filtro local previo,
 * que responde 422 sin salir a la red y sigue funcionando si HIBP esta caido.
 */
const PROHIBIDAS = new Set([
  'password123', 'contrasena123', 'contraseña123', 'qwerty123456', 'administrador1',
  '123456789012', 'password1234', 'iloveyou1234', 'welcome12345', 'admin1234567',
]);

export function esPasswordComun(plain: string): boolean {
  return PROHIBIDAS.has(plain.toLowerCase());
}
