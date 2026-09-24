import { defaultExclude, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // tests/e2e/** tiene su propio runner (vitest.e2e.config.mts): arranca un
    // proceso real aparte y usa su propia BD (hospital_e2e); no debe correr
    // como parte de `npm test`.
    exclude: [...defaultExclude, 'tests/e2e/**'],
    // Los tests de integracion comparten una base de datos: sin esto se pisan.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/scripts/**', 'src/**/*.d.ts', 'src/core/openapi/**'],
      thresholds: { lines: 60, functions: 60, branches: 60, statements: 60 },
    },
  },
});
