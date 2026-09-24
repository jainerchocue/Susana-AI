import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { UserStatus } from '@prisma/client';
import { limitePorUsuario } from '../../src/core/middleware/rate-limit';
import type { AuthenticatedUser } from '../../src/core/middleware/authenticate';

/**
 * `limitePorUsuario` en aislamiento: una app Express minima, sin BD ni Better
 * Auth, que rellena `req.auth` a mano segun una cabecera de prueba. No
 * reutiliza `getApp()` porque el objetivo es el limitador solo, con un tope
 * pequeño (T5, plan §"rate-limit.test.ts").
 */

function usuarioDePrueba(id: string): AuthenticatedUser {
  return {
    id,
    email: `${id}@test.local`,
    emailVerified: true,
    status: UserStatus.ACTIVE,
    sessionId: `sesion-${id}`,
    roles: [],
    permissions: new Set(),
  };
}

/** App minima: solo el middleware bajo prueba, tras rellenar req.auth a mano. */
function appConLimite(tope: number): express.Express {
  const app = express();
  app.use((req, _res, next) => {
    const userId = req.get('x-test-user');
    if (userId) req.auth = usuarioDePrueba(userId);
    next();
  });
  app.use(limitePorUsuario('t', tope));
  app.get('/', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('limitePorUsuario', () => {
  it('la 3a peticion del mismo usuario da 429 RATE_LIMITED', async () => {
    const app = appConLimite(2);
    const pedir = () => request(app).get('/').set('x-test-user', 'user-a');

    expect((await pedir()).status).toBe(200);
    expect((await pedir()).status).toBe(200);

    const tercera = await pedir();
    expect(tercera.status).toBe(429);
    expect(tercera.body.error.code).toBe('RATE_LIMITED');
  });

  it('dos usuarios distintos tienen cupos independientes', async () => {
    const app = appConLimite(2);
    const pedirComo = (usuario: string) => request(app).get('/').set('x-test-user', usuario);

    expect((await pedirComo('user-b')).status).toBe(200);
    expect((await pedirComo('user-b')).status).toBe(200);
    expect((await pedirComo('user-b')).status).toBe(429);

    // user-c no arranca ya penalizado por el cupo agotado de user-b.
    expect((await pedirComo('user-c')).status).toBe(200);
    expect((await pedirComo('user-c')).status).toBe(200);
    expect((await pedirComo('user-c')).status).toBe(429);
  });
});
