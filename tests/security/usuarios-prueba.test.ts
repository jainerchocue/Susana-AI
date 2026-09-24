import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { api, getApp, login, prisma, rolesDe } from '../helpers';

/**
 * T7: el seed de usuarios de prueba (DIRECTOR y FARMACIA) debe ser idempotente
 * y las cuentas deben poder iniciar sesion DE VERDAD, no solo existir en la
 * BD. Corre el seed real dos veces contra la misma base que usan estos tests
 * (`hospital_test_d`, via DATABASE_URL) para probar exactamente lo que el
 * operador ejecuta en produccion.
 */
describe('Seed · usuarios de prueba (DIRECTOR y FARMACIA)', () => {
  beforeAll(async () => {
    await getApp();
    ejecutarSeed();
    ejecutarSeed(); // segunda corrida: no debe fallar ni duplicar nada.
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('crea al director de prueba, verificado, con el rol DIRECTOR y sin sesiones abiertas', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: env.SEED_DIRECTOR_EMAIL },
      select: { id: true, emailVerified: true },
    });
    expect(user.emailVerified).toBe(true);
    expect(await rolesDe(user.id)).toEqual(['DIRECTOR']);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('crea a farmacia de prueba, verificada, con el rol FARMACIA y sin sesiones abiertas', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: env.SEED_FARMACIA_EMAIL },
      select: { id: true, emailVerified: true },
    });
    expect(user.emailVerified).toBe(true);
    expect(await rolesDe(user.id)).toEqual(['FARMACIA']);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('no duplica cuentas al correr el seed dos veces seguidas', async () => {
    const total = await prisma.user.count({
      where: { email: { in: [env.SEED_DIRECTOR_EMAIL, env.SEED_FARMACIA_EMAIL] } },
    });
    expect(total).toBe(2);
  });

  it('el director de prueba inicia sesion de verdad con SEED_TEST_PASSWORD', async () => {
    const token = await login(env.SEED_DIRECTOR_EMAIL, env.SEED_TEST_PASSWORD);
    expect(token).toBeTruthy();

    const res = await api().get('/api/v1/users/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(env.SEED_DIRECTOR_EMAIL);
  });

  it('farmacia de prueba inicia sesion de verdad con SEED_TEST_PASSWORD', async () => {
    const token = await login(env.SEED_FARMACIA_EMAIL, env.SEED_TEST_PASSWORD);
    expect(token).toBeTruthy();

    const res = await api().get('/api/v1/users/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(env.SEED_FARMACIA_EMAIL);
  });

  it('una contraseña incorrecta sigue rechazandose (el seed no debilito el login)', async () => {
    const res = await api()
      .post('/api/v1/auth/sign-in/email')
      .send({ email: env.SEED_DIRECTOR_EMAIL, password: 'una-contraseña-incorrecta-123' });
    expect(res.status).toBe(401);
  });
});

/** Corre el seed real (mismo comando que documenta el plan) contra DATABASE_URL. */
function ejecutarSeed(): void {
  execFileSync('npx', ['tsx', 'prisma/seed.ts'], {
    cwd: path.resolve(__dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
}
