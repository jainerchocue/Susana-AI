import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { iniciarServidor, type ServidorIniciado } from './servidor';
import { Sesion } from './cliente';

/**
 * T13 (ola E2): limites por defecto de `.env.example`, en un servidor PROPIO
 * (puerto 3310/3311) para no interferir con el servidor compartido de
 * `global-setup.ts`, que arranca con limites altos a proposito (E1).
 *
 * Tres limitadores independientes, cada uno con su propio contador:
 *  1. El de Better Auth para `/sign-in/email` (rateLimit.customRules en
 *     auth.ts): por IP y RUTA, max 5 en 60s.
 *  2. `authRateLimit` (core/middleware/rate-limit.ts): el borde, por IP, para
 *     TODA la superficie `/auth/**`, max 20 en 60s. Cuenta cada peticion a
 *     `/auth/**` sin importar que endpoint sea ni que responda Better Auth.
 *  3. `globalRateLimit`: por IP, para el resto de la API (no `/auth`, no
 *     `/health`), max 120 en 60s.
 * Al ser instancias de `express-rate-limit` separadas (o reglas propias de
 * Better Auth), no comparten contador entre si.
 */

const PUERTO = 3310;
const PREFIJO = env.API_PREFIX;

function comoRegistro(valor: unknown): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null) {
    throw new Error(`Se esperaba un objeto JSON; se recibio: ${JSON.stringify(valor)}`);
  }
  return valor as Record<string, unknown>;
}

let servidor: ServidorIniciado;

beforeAll(async () => {
  // Limites por defecto de `.env.example`, explicitos: `iniciarServidor` los
  // eleva a 100000 por defecto (pensados para el servidor compartido), asi
  // que aqui se sobrescriben de vuelta a los valores reales.
  servidor = await iniciarServidor({
    puerto: PUERTO,
    env: {
      RATE_LIMIT_WINDOW_MS: '60000',
      RATE_LIMIT_MAX: '120',
      AUTH_RATE_LIMIT_MAX: '20',
      AUTH_SIGNIN_MAX: '5',
      AUTH_SIGNUP_MAX: '3',
      AUTH_MFA_MAX: '5',
    },
  });
});

afterAll(async () => {
  await servidor.detener();
});

describe('T13 - limites por defecto (.env.example)', () => {
  it(
    'el 6º sign-in en 60s -> 429 (Better Auth); el 21º a /auth/** -> 429 con sobre RATE_LIMITED y cabeceras RateLimit',
    async () => {
      const correoInexistente = 'nadie-limites@e2e.test';

      // 5 intentos de sign-in: no deben chocar con ningun limite todavia.
      for (let i = 0; i < 5; i += 1) {
        const r = await new Sesion(servidor.url).login(correoInexistente, 'ClaveInventada123!');
        expect(r.status).not.toBe(429);
      }
      // 6º intento en la misma ventana de 60s: Better Auth corta con su propia
      // regla de /sign-in/email (max 5), antes de mirar las credenciales.
      const sexto = await new Sesion(servidor.url).login(correoInexistente, 'ClaveInventada123!');
      expect(sexto.status).toBe(429);

      // Las 6 peticiones anteriores tambien pasaron por `authRateLimit` (el
      // borde cuenta TODA peticion a /auth/**, gane o pierda Better Auth
      // despues): van 6 de las 20 permitidas. Se completan 14 mas contra un
      // endpoint SIN regla propia de Better Auth (`get-session`, limite
      // general 120/60s) para no volver a tropezar con el limite de sign-in.
      for (let i = 0; i < 14; i += 1) {
        const r = await new Sesion(servidor.url).get(`${PREFIJO}/auth/get-session`);
        expect(r.status).not.toBe(429);
      }

      // 21ª peticion a /auth/**: el borde corta con nuestro propio sobre.
      const bloqueada = await new Sesion(servidor.url).get(`${PREFIJO}/auth/get-session`);
      expect(bloqueada.status).toBe(429);
      expect(bloqueada.headers.get('ratelimit')).toBeTruthy();
      const cuerpo = comoRegistro(bloqueada.body);
      expect(cuerpo.success).toBe(false);
      expect(comoRegistro(cuerpo.error).code).toBe('RATE_LIMITED');
    },
    20_000,
  );

  it(
    'el limite global de la API responde 429 tras agotar el cupo; /health nunca da 429',
    async () => {
      const sesion = new Sesion(servidor.url);
      let ultima: Awaited<ReturnType<Sesion['get']>> | undefined;
      // RATE_LIMIT_MAX=120: la 121ª peticion a una ruta publica no-auth/no-health corta.
      for (let i = 0; i < 121; i += 1) {
        ultima = await sesion.get(PREFIJO);
      }
      expect(ultima?.status).toBe(429);
      const cuerpo = comoRegistro(ultima?.body);
      expect(cuerpo.success).toBe(false);
      expect(comoRegistro(cuerpo.error).code).toBe('RATE_LIMITED');

      // El cupo global esta agotado y aun asi /health sigue en 200: el `skip`
      // de `globalRateLimit` para health existe justo para esto (CLAUDE.md §15).
      const salud = await sesion.get(`${PREFIJO}/health`);
      expect(salud.status).toBe(200);
    },
    20_000,
  );
});
