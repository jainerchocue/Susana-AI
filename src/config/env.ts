import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Unico punto donde se lee process.env. Si falta o esta mal una variable,
 * el proceso muere al arrancar (fail fast) en vez de explotar en runtime.
 */

// ponytail: process.loadEnvFile es stdlib (Node >=20.12), no hace falta dotenv.
const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

/**
 * `DOCS_ENABLED` por defecto es `true`, EXCEPTO en produccion, donde por
 * defecto es `false` salvo que se active de forma explicita (`DOCS_ENABLED=true`
 * en el entorno). Un `.default()` de Zod no puede depender de otro campo, asi
 * que el valor por defecto se resuelve aqui, antes de validar, sobre el
 * `NODE_ENV` crudo (el mismo criterio que usara luego el propio schema).
 */
if (process.env.DOCS_ENABLED === undefined) {
  process.env.DOCS_ENABLED = process.env.NODE_ENV === 'production' ? 'false' : 'true';
}

const csv = z
  .string()
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean));

// Acepta las formas habituales en Docker, no solo 'true'/'false' (B-05).
const bool = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(['true', '1', 'yes', 'on', 'false', '0', 'no', 'off']))
  .transform((v) => ['true', '1', 'yes', 'on'].includes(v));

/**
 * Valores publicados en el repositorio. Que una cadena sea larga no la
 * convierte en secreta: si esta en Git, es publica (C-04).
 */
const SECRETOS_PROHIBIDOS = [
  'cambia-esto',
  'changeme',
  'change-me',
  'your-secret',
  'supersecret',
  'secret-key',
  'insecure',
  'example',
];

/** Un secreto de 64 caracteres repetidos tiene 1 bit de entropia real. */
function entropiaSuficiente(valor: string): boolean {
  return new Set(valor).size >= 16;
}

interface ClavesAgente {
  agentUrl: string | undefined;
  agentApiKey: string | undefined;
  internalApiKey: string | undefined;
  nodeEnv: 'development' | 'test' | 'production';
}

/**
 * Valida las dos claves del agente por separado del resto: extraida para que
 * el `superRefine` principal no se dispare en complejidad ciclomatica.
 *
 * Con AGENT_URL configurada, las dos claves son obligatorias en TODOS los
 * entornos: sin ellas Node no puede hablar con Python ni verificar quien le
 * habla a el. Dos claves distintas porque son dos sentidos: filtrar una no
 * debe permitir el sentido contrario.
 */
function validarClavesAgente(v: ClavesAgente, ctx: z.RefinementCtx): void {
  if (v.agentUrl) {
    if (!v.agentApiKey) {
      ctx.addIssue({ code: 'custom', path: ['AGENT_API_KEY'], message: 'Obligatoria con AGENT_URL definida.' });
    }
    if (!v.internalApiKey) {
      ctx.addIssue({ code: 'custom', path: ['INTERNAL_API_KEY'], message: 'Obligatoria con AGENT_URL definida.' });
    }
    if (v.agentApiKey && v.internalApiKey && v.agentApiKey === v.internalApiKey) {
      ctx.addIssue({
        code: 'custom',
        path: ['INTERNAL_API_KEY'],
        message: 'Debe ser distinta de AGENT_API_KEY: una clave por sentido.',
      });
    }
  }

  for (const [campo, valorClave] of [
    ['AGENT_API_KEY', v.agentApiKey],
    ['INTERNAL_API_KEY', v.internalApiKey],
  ] as const) {
    if (!valorClave) continue;
    const marcaClave = SECRETOS_PROHIBIDOS.find((p) => valorClave.toLowerCase().includes(p));
    if (marcaClave) {
      ctx.addIssue({
        code: 'custom',
        path: [campo],
        message: `Contiene "${marcaClave}": es un valor de ejemplo del repositorio.`,
      });
    }
    if (v.nodeEnv === 'production' && !entropiaSuficiente(valorClave)) {
      ctx.addIssue({ code: 'custom', path: [campo], message: 'Entropia insuficiente (menos de 16 simbolos distintos).' });
    }
  }
}

/**
 * Extraida por la misma razon que `validarClavesAgente`: mantener el
 * `superRefine` principal por debajo del limite de complejidad ciclomatica.
 *
 * Solo se llama en produccion: en el resto de entornos SEED_TEST_USERS=true
 * es justamente el caso de uso (levantar DIRECTOR/FARMACIA de prueba).
 */
function validarUsuariosDePrueba(
  v: { SEED_TEST_USERS: boolean; SEED_TEST_PASSWORD: string },
  ctx: z.RefinementCtx,
): void {
  if (v.SEED_TEST_USERS) {
    ctx.addIssue({
      code: 'custom',
      path: ['SEED_TEST_USERS'],
      message: 'Los usuarios de prueba (DIRECTOR/FARMACIA de prueba) no se crean en produccion: ponlo en false.',
    });
  }
  if (v.SEED_TEST_PASSWORD === 'Prueba123!Hospital') {
    ctx.addIssue({ code: 'custom', path: ['SEED_TEST_PASSWORD'], message: 'Es la contraseña de ejemplo.' });
  }
}

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    API_PREFIX: z.string().startsWith('/').default('/api/v1'),
    CORS_ORIGINS: csv.default('http://localhost:5173'),
    APP_URL: z.string().url(),
    API_URL: z.string().url(),
    LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    /**
     * false | numero de saltos | lista de CIDR separada por coma.
     * Un contador fijo miente en cuanto hay CDN + balanceador (M-14).
     */
    TRUST_PROXY: z.string().default('false'),

    DATABASE_URL: z.string().url(),
    /** Opcional: sin Redis el rate limit y la cache degradan a memoria local. */
    REDIS_URL: z.string().url().optional(),

    // ─── HTTP ────────────────────────────────────────────────────────────────
    HTTP_HEADERS_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    /** Debe superar el idle timeout del balanceador o aparecen 502 esporadicos. */
    HTTP_KEEPALIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(65_000),
    BODY_LIMIT: z.string().default('256kb'),

    // ─── Better Auth ─────────────────────────────────────────────────────────
    /** Firma cookies de sesion y cifra el secreto TOTP. openssl rand -base64 48 */
    BETTER_AUTH_SECRET: z.string().min(32, 'Debe tener al menos 32 caracteres'),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
    /** Cada cuanto se renueva la sesion viva, en horas. */
    SESSION_UPDATE_AGE_HOURS: z.coerce.number().int().positive().default(24),
    /** Ventana en la que una sesion se considera "fresca" para acciones sensibles. */
    SESSION_FRESH_AGE_MINUTES: z.coerce.number().int().min(0).default(60),
    /**
     * Cache de sesion en cookie firmada, propia de Better Auth. `core/middleware/
     * authenticate.ts` pide `disableCookieCache: true` en cada peticion, asi que
     * NINGUNA ruta de nuestra API (todo lo que no sea `/auth/**`) se beneficia de
     * esta cache ni sufre su desfase: una sesion revocada corta en el acto. Esta
     * variable solo afecta a quien llame directamente a `GET {API_PREFIX}/auth/
     * get-session` (el propio endpoint de Better Auth) sin pedir
     * `disableCookieCache=true`. 0 la desactiva del todo (siempre consulta la BD).
     */
    SESSION_COOKIE_CACHE_SECONDS: z.coerce.number().int().min(0).max(900).default(60),

    // ─── Cookies ─────────────────────────────────────────────────────────────
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: bool.default('false'),
    /** 'none' exige despliegue multi-dominio + Secure (A-10). */
    COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('lax'),

    // ─── Seguridad ───────────────────────────────────────────────────────────
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    /** Limite por IP del borde, delante del handler de Better Auth. */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
    /** Limite propio de Better Auth para /sign-in/email, por IP y ventana. */
    AUTH_SIGNIN_MAX: z.coerce.number().int().positive().default(5),
    AUTH_SIGNUP_MAX: z.coerce.number().int().positive().default(3),
    /** Intentos de segundo factor por ventana. 6 digitos son 10^6 (A-16). */
    AUTH_MFA_MAX: z.coerce.number().int().positive().default(5),
    EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().positive().default(24),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
    REQUIRE_VERIFIED_EMAIL: bool.default('true'),
    /**
     * Consulta a HaveIBeenPwned (k-anonimato) en registro y cambio de clave.
     * OJO: falla CERRADO. Si su API no responde, esas dos operaciones devuelven
     * 500. Ponla en false en despliegues sin salida a internet; queda el filtro
     * local de `esPasswordComun` como suelo.
     */
    PASSWORD_BREACH_CHECK: bool.default('true'),
    /** Hashes de contraseña simultaneos. Por encima se responde 503 (C-03). */
    PASSWORD_HASH_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
    /** TTL de la cache de permisos. 0 la desactiva (A-05). */
    RBAC_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(300),
    MFA_ISSUER: z.string().default('Hospital Intelligence'),
    /** Purga periodica de sesiones y verificaciones caducadas (A-06). */
    PURGE_ENABLED: bool.default('true'),
    PURGE_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
    PURGE_RETENTION_DAYS: z.coerce.number().int().positive().default(7),

    // ─── Email (Resend) ──────────────────────────────────────────────────────
    MAIL_ENABLED: bool.default('true'),
    RESEND_API_KEY: z.string().optional(),
    MAIL_FROM_NAME: z.string().default('Hospital Intelligence'),
    MAIL_FROM_EMAIL: z.string().email(),
    MAIL_REPLY_TO: z.string().email().optional(),

    // ─── Seed ────────────────────────────────────────────────────────────────
    SEED_ADMIN_EMAIL: z.string().trim().toLowerCase().email().default('admin@plantilla.dev'),
    SEED_ADMIN_PASSWORD: z.string().min(12).default('Admin123!CambiarYa'),

    // ─── Usuarios de prueba (seed) ───────────────────────────────────────────
    /** Crea DIRECTOR y FARMACIA de prueba (verificados, idempotente). Prohibido en produccion. */
    SEED_TEST_USERS: bool.default('true'),
    SEED_TEST_PASSWORD: z.string().min(12).default('Prueba123!Hospital'),
    SEED_DIRECTOR_EMAIL: z.string().trim().toLowerCase().email().default('director@hospital.test'),
    SEED_FARMACIA_EMAIL: z.string().trim().toLowerCase().email().default('farmacia@hospital.test'),

    // ─── Registro publico ──────────────────────────────────────────────────
    /** Un hospital no tiene autoregistro: las altas las hace un administrador. */
    AUTH_PUBLIC_SIGNUP: bool.default('false'),

    // ─── Agente IA (Python) ─────────────────────────────────────────────────
    /** Sin ella, /assistant responde 503: el asistente no esta disponible. */
    AGENT_URL: z.string().url().optional(),
    /** Node -> Python. Distinta de INTERNAL_API_KEY: filtrar una no filtra el sentido contrario. */
    AGENT_API_KEY: z.string().min(32).optional(),
    /** Python -> Node. Sin ella, el puerto interno no arranca (cierra en fallo). */
    INTERNAL_API_KEY: z.string().min(32).optional(),
    AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
    AGENT_TICKET_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    AGENT_MAX_QUERIES_BASIC: z.coerce.number().int().positive().default(2),
    AGENT_MAX_QUERIES_ADVANCED: z.coerce.number().int().positive().default(5),
    AGENT_MAX_ROWS: z.coerce.number().int().min(1).max(1000).default(200),
    AGENT_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

    // ─── API interna del agente (segundo puerto, solo 127.0.0.1) ───────────
    INTERNAL_HOST: z.string().default('127.0.0.1'),
    INTERNAL_PORT: z.coerce.number().int().positive().default(3001),
    INTERNAL_ALLOWED_IPS: csv.default('127.0.0.1,::1'),
    /** Por usuario autenticado, en la ventana RATE_LIMIT_WINDOW_MS. */
    ASSISTANT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    /** Por IP: en el puerto interno no hay usuario autenticado que usar de clave. */
    INTERNAL_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

    // ─── Umbrales del motor de alertas ──────────────────────────────────────
    ALERT_LOW_STOCK_DAYS: z.coerce.number().positive().default(7),
    ALERT_CRITICAL_STOCK_DAYS: z.coerce.number().positive().default(3),
    ALERT_OCCUPANCY_PCT: z.coerce.number().positive().default(85),
    ALERT_CRITICAL_OCCUPANCY_PCT: z.coerce.number().positive().default(95),
    ALERT_WAIT_MINUTES: z.coerce.number().positive().default(60),
    ALERT_DEMAND_SPIKE_PCT: z.coerce.number().positive().default(30),
    ALERT_SURGERY_CANCELLATION_PCT: z.coerce.number().positive().default(15),
    /** Job periodico del motor de alertas (T11). false en tests: el motor se ejercita a mano. */
    ALERT_EVAL_ENABLED: bool.default('true'),
    ALERT_EVAL_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),

    // ─── Imports CSV por API (TC1) ───────────────────────────────────────────
    /** Tamaño maximo de un archivo subido a `POST /imports/:table`. */
    IMPORT_MAX_MB: z.coerce.number().int().positive().default(200),

    // ─── Documentacion (/api/v1/docs, TC0) ───────────────────────────────────
    /** Su valor por defecto (true salvo en produccion) se resuelve arriba, antes de parsear. */
    DOCS_ENABLED: bool,
  })
  .superRefine((v, ctx) => {
    // Secretos de ejemplo: se rechazan en TODOS los entornos, no solo produccion.
    const valor = v.BETTER_AUTH_SECRET.toLowerCase();
    const marca = SECRETOS_PROHIBIDOS.find((p) => valor.includes(p));
    if (marca) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message: `Contiene "${marca}": es un valor de ejemplo del repositorio. Genera uno con: openssl rand -base64 48`,
      });
    }

    if (v.COOKIE_SAMESITE === 'none' && !v.COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'SameSite=none exige Secure=true.' });
    }

    if (v.MAIL_ENABLED && !v.RESEND_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'Obligatoria con MAIL_ENABLED=true.' });
    }

    validarClavesAgente(
      { agentUrl: v.AGENT_URL, agentApiKey: v.AGENT_API_KEY, internalApiKey: v.INTERNAL_API_KEY, nodeEnv: v.NODE_ENV },
      ctx,
    );

    if (v.NODE_ENV === 'production') {
      if (!v.COOKIE_SECURE) {
        ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Debe ser true en produccion.' });
      }
      if (v.CORS_ORIGINS.includes('*')) {
        ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'No se permite "*" en produccion.' });
      }
      if (!v.REDIS_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['REDIS_URL'],
          message: 'Obligatoria en produccion: sin ella el rate limit es por proceso y no protege nada.',
        });
      }
      if (v.BETTER_AUTH_SECRET.length < 48) {
        ctx.addIssue({ code: 'custom', path: ['BETTER_AUTH_SECRET'], message: 'Minimo 48 caracteres en produccion.' });
      }
      if (!entropiaSuficiente(v.BETTER_AUTH_SECRET)) {
        ctx.addIssue({
          code: 'custom',
          path: ['BETTER_AUTH_SECRET'],
          message: 'Entropia insuficiente (menos de 16 simbolos distintos).',
        });
      }
      if (v.SEED_ADMIN_PASSWORD === 'Admin123!CambiarYa') {
        ctx.addIssue({ code: 'custom', path: ['SEED_ADMIN_PASSWORD'], message: 'Es la contraseña de ejemplo.' });
      }
      if (v.CORS_ORIGINS.some((o) => o.startsWith('http://'))) {
        ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Solo https en produccion.' });
      }
      validarUsuariosDePrueba(v, ctx);
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const detalle = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`)
    .join('\n');
  process.stderr.write(`\n[env] Configuracion invalida:\n${detalle}\n\n`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

/** Traduce TRUST_PROXY a lo que espera Express. */
export function trustProxyValue(): boolean | number | string[] {
  const raw = env.TRUST_PROXY.trim();
  if (raw === 'false' || raw === '') return false;
  if (raw === 'true') return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
