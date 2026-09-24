import { defineConfig } from 'vitest/config';

/**
 * Suite E2E (T12, E1): proceso real, HTTP de verdad, BD `hospital_e2e`.
 * Sin `setupFiles`: no hereda los valores de `tests/setup.ts` (esos son para
 * los 481 tests de integracion en memoria; aqui el proceso hijo trae su
 * propia configuracion, ver `tests/e2e/servidor.ts`).
 */
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    // Los archivos comparten un unico servidor y una unica BD: en paralelo se pisarian.
    fileParallelism: false,
    testTimeout: 60_000,
    // La importacion de los datos HIS reales en el global setup tarda ~30s.
    hookTimeout: 180_000,
    globalSetup: ['tests/e2e/global-setup.ts'],
  },
});
