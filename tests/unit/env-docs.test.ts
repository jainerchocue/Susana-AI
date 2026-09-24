import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `DOCS_ENABLED` (TC0): por defecto `true`, EXCEPTO en produccion, donde por
 * defecto es `false` salvo activacion explicita. `env.ts` es un singleton que
 * ya se cargo con los valores de `tests/setup.ts` en este proceso, asi que la
 * unica forma fiable de probar las tres combinaciones es en un subproceso
 * limpio (igual que la comprobacion manual hecha para el reporte de esta tarea).
 */
const BASE_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  BETTER_AUTH_SECRET: 'proceso-hijo-secreto-0123456789abcdefghijklmnopqrstuv',
  APP_URL: 'https://app.example.com',
  API_URL: 'https://api.example.com',
  DATABASE_URL: 'postgresql://jhon@localhost:5432/hospital_local?schema=public',
  MAIL_ENABLED: 'false',
  MAIL_FROM_EMAIL: 'no-reply@example.com',
  // Solo hacen falta en produccion, pero no estorban en desarrollo/test.
  COOKIE_SECURE: 'true',
  CORS_ORIGINS: 'https://app.example.com',
  REDIS_URL: 'redis://localhost:6379',
  SEED_ADMIN_PASSWORD: 'Xk8pQ2vLmN9wRtYuZaBcDe',
  SEED_TEST_USERS: 'false',
  SEED_TEST_PASSWORD: 'OtraClaveDeSubprocesoNoLaDeEjemplo123',
};

function docsEnabledEnSubproceso(extra: NodeJS.ProcessEnv): boolean {
  const salida = execFileSync(
    process.execPath,
    ['--require', 'tsx/cjs', '-e', "console.log(require('./src/config/env').env.DOCS_ENABLED)"],
    { cwd: path.resolve(__dirname, '..', '..'), env: { ...BASE_ENV, ...extra }, encoding: 'utf-8' },
  );
  return salida.trim() === 'true';
}

describe('env.DOCS_ENABLED: default segun entorno (TC0)', () => {
  it('development, sin variable: true', () => {
    expect(docsEnabledEnSubproceso({ NODE_ENV: 'development', DOCS_ENABLED: undefined })).toBe(true);
  });

  it('produccion, sin variable: false', () => {
    expect(docsEnabledEnSubproceso({ NODE_ENV: 'production', DOCS_ENABLED: undefined })).toBe(false);
  });

  it('produccion, DOCS_ENABLED=true explicito: true', () => {
    expect(docsEnabledEnSubproceso({ NODE_ENV: 'production', DOCS_ENABLED: 'true' })).toBe(true);
  });
});
