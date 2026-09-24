/**
 * Configuracion comun de los tests. Se ejecuta antes de cada fichero.
 * Los valores solo se rellenan si faltan: en CI vienen del workflow.
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:5173',
  API_URL: 'http://localhost:3000',
  // Fijado a proposito: sin esto, `env.ts` (con su propio `process.loadEnvFile`)
  // rellena CORS_ORIGINS desde el `.env` real de quien corra los tests. Ese
  // `.env` es para `npm run dev` y puede traer valores de conveniencia (p.ej.
  // `*`) que no representan ningun origen real: los tests de CSRF/CORS de
  // `tests/security/auth.test.ts` asumen el origen `http://localhost:5173`
  // (el mismo que usa la suite E2E en `tests/e2e/cliente.ts`), y con `*` (que
  // `verificarOrigen` rechaza a proposito, CLAUDE.md §15) fallaban siempre,
  // no de forma intermitente.
  CORS_ORIGINS: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'test-secret-0123456789abcdefghijklmnopqrstuvwxyz-XYZ',
  MAIL_ENABLED: 'false',
  MAIL_FROM_EMAIL: 'no-reply@test.local',
  REQUIRE_VERIFIED_EMAIL: 'false',
  LOG_LEVEL: 'silent',
  // Los limites se desactivan en la practica: un test que hace 40 logins no
  // debe fallar por rate limit. Hay tests dedicados que los comprueban aparte.
  RATE_LIMIT_MAX: '100000',
  AUTH_RATE_LIMIT_MAX: '100000',
  AUTH_SIGNIN_MAX: '100000',
  AUTH_SIGNUP_MAX: '100000',
  AUTH_MFA_MAX: '100000',
  // Sin cache: cada test debe ver el estado real de la BD, no uno de hace 5 min.
  RBAC_CACHE_TTL_SECONDS: '0',
  // Sin cache de sesion en cookie: revocar debe notarse en la peticion siguiente.
  SESSION_COOKIE_CACHE_SECONDS: '0',
  PURGE_ENABLED: 'false',
  // Sin red en CI: el chequeo de HIBP falla cerrado y tumbaria cada registro.
  PASSWORD_BREACH_CHECK: 'false',
  // Sin autoregistro por defecto (T1): los tests que ejercen /sign-up/email
  // lo necesitan habilitado, igual que hoy lo hacen contra la libreria real.
  AUTH_PUBLIC_SIGNUP: 'true',
  // Stub de Python en node:http, levantado por los propios tests del asistente.
  AGENT_URL: 'http://127.0.0.1:18765',
  AGENT_API_KEY: 'test-agent-key-0123456789abcdefghijklmnop',
  INTERNAL_API_KEY: 'test-internal-key-0123456789abcdefghijklm',
  AGENT_TIMEOUT_MS: '3000',
  // Igual que el resto de limites: desactivados en la practica para no
  // interferir con tests que no son los suyos.
  ASSISTANT_RATE_LIMIT_MAX: '100000',
  INTERNAL_RATE_LIMIT_MAX: '100000',
  // El job periodico del motor de alertas no debe correr solo por importar la
  // app en un test: cada test que quiera evaluarlo llama a POST /alerts/evaluate.
  ALERT_EVAL_ENABLED: 'false',
};

/**
 * `npm run test:real` (T6) fija REAL_DATA=1 y NO debe tener aqui un valor por
 * defecto para DATABASE_URL: el objetivo es usar la de `.env` (hospital_local,
 * con los datos reales importados por `npm run data:import`), no una base de
 * tests vacia.
 */
if (process.env.REAL_DATA !== '1') {
  defaults.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/test?schema=public';
}

for (const [clave, valor] of Object.entries(defaults)) process.env[clave] ??= valor;
