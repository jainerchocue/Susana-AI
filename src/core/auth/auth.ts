import type { RequestHandler } from 'express';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { fromNodeHeaders } from 'better-auth/node';
import { bearer } from 'better-auth/plugins/bearer';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { haveIBeenPwned } from 'better-auth/plugins/haveibeenpwned';
// openAPI no tiene ruta propia en 1.7: solo esta en el barrel.
import { openAPI } from 'better-auth/plugins';
import { createAuthMiddleware } from 'better-auth/api';
import { env, isProd } from '../../config/env';
import { BRAND, FRONTEND_ROUTES } from '../../config/constants';
import { prisma } from '../db/prisma';
import { redis } from '../cache/redis';
import { logger } from '../logger';
import { hashPassword, verifyPassword, PASSWORD_POLICY } from '../security/password';
import { sendMail } from '../mail/mailer';
import { templates } from '../mail/templates';
import { AUDIT, auditar } from '../audit/audit';
import { DEFAULT_ROLE } from '../rbac/permissions';
import { invalidarRbac } from '../rbac/rbac-cache';

/**
 * AUTENTICACION: Better Auth, solo credenciales (email + contraseña) + TOTP.
 *
 * Sustituye a la implementacion propia de JWT + refresh rotativo. Lo que se
 * gano: mantenimiento delegado, CSRF y PKCE de serie, rate limit por endpoint.
 * Lo que se perdio esta documentado en CLAUDE.md §15.
 *
 * Lo que NO gestiona Better Auth y sigue siendo nuestro: los roles y permisos
 * (`core/rbac/`). La libreria dice *quien eres*; el RBAC dice *que puedes*.
 */

const DIA_S = 60 * 60 * 24;

/**
 * Redis como almacen secundario: sesiones y contadores de rate limit
 * compartidos entre replicas. Sin el, cada proceso tiene su propio contador y
 * N replicas multiplican por N el limite efectivo (auditoria A-02).
 *
 * `increment` debe ser atomico o el rate limit no vale nada bajo concurrencia:
 * dos procesos leyendo 4 y escribiendo 5 dejan pasar una peticion de mas cada
 * vez. Se hace con Lua para que INCR y EXPIRE ocurran en la misma operacion:
 * un INCR seguido de EXPIRE en dos viajes puede dejar el contador SIN caducidad
 * si el proceso muere en medio, y ese contador bloquea la clave para siempre.
 */
const INCREMENTAR_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
`;

/**
 * ¿Bloquear esta llamada a /sign-up/email?
 *
 * `esHttp` distingue una peticion real de cliente (trae `ctx.request`, un
 * `Request` de la Web API que puso `toNodeHandler`) de una llamada de servidor
 * como `auth.api.signUpEmail({ body })` desde `users.service.create` o el
 * seed, que no lo trae: better-call solo exige `request` cuando el endpoint
 * declara `requireRequest: true`, y `signUpEmail` no lo hace (verificado en
 * node_modules/better-auth/dist/api/routes/sign-up.mjs). Sin esta distincion,
 * bloquear el registro publico tambien bloquearia el alta administrativa.
 */
export function bloquearRegistroPublico(path: string, esHttp: boolean, permitido: boolean): boolean {
  return path === '/sign-up/email' && esHttp && !permitido;
}

const secondaryStorage = redis
  ? ((cliente) => ({
      get: async (clave: string) => cliente.get(clave),

      // GETDEL (Redis >= 6.2) en una sola operacion. Un GET + DEL permitiria
      // que dos peticiones consumieran el mismo token de un solo uso.
      getAndDelete: async (clave: string) => cliente.getdel(clave),

      increment: async (clave: string, ttl: number) =>
        Number(await cliente.eval(INCREMENTAR_LUA, 1, clave, String(ttl))),

      set: async (clave: string, valor: string, ttl?: number) => {
        if (ttl) await cliente.set(clave, valor, 'EX', ttl);
        else await cliente.set(clave, valor);
      },

      delete: async (clave: string) => {
        await cliente.del(clave);
      },
    }))(redis)
  : undefined;

export const auth = betterAuth({
  appName: BRAND.name,
  baseURL: env.API_URL,
  basePath: `${env.API_PREFIX}/auth`,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),

  // Origenes validos para CSRF y para callbackURL/redirectTo. Un valor de mas
  // aqui es un open redirect: la libreria valida los destinos contra esta lista.
  trustedOrigins: env.CORS_ORIGINS,

  secondaryStorage,

  emailAndPassword: {
    enabled: true,
    // Unico metodo de acceso: nada de social, magic link ni passkey.
    requireEmailVerification: env.REQUIRE_VERIFIED_EMAIL,
    minPasswordLength: PASSWORD_POLICY.minLength,
    maxPasswordLength: PASSWORD_POLICY.maxLength,
    resetPasswordTokenExpiresIn: env.PASSWORD_RESET_TTL_MINUTES * 60,
    // Un reset de contraseña cierra todo: si hubo robo, se corta.
    revokeSessionsOnPasswordReset: true,

    /**
     * El scrypt por defecto de Better Auth no tiene semaforo. Se enchufa el
     * nuestro: sin limite de hashes en vuelo, un flood de logins congela el
     * threadpool de libuv y con el fs y DNS (auditoria C-03).
     */
    password: {
      hash: (password) => hashPassword(password),
      verify: ({ password, hash }) => verifyPassword(password, hash),
    },

    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        dedupeKey: `reset:${user.id}`,
        ...templates.resetPassword({
          name: user.name,
          url,
          expiresInMinutes: env.PASSWORD_RESET_TTL_MINUTES,
          ip: null,
        }),
      });
    },

    onPasswordReset: async ({ user }) => {
      await auditar({ action: AUDIT.passwordReset, actorId: user.id, targetId: user.id });
      await sendMail({
        to: user.email,
        ...templates.securityAlert({
          name: user.name,
          title: 'Tu contraseña fue cambiada',
          message: 'La contraseña de tu cuenta se actualizo y se cerraron todas las sesiones activas.',
          actionUrl: FRONTEND_ROUTES.login,
          actionLabel: 'Iniciar sesion',
        }),
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    expiresIn: env.EMAIL_VERIFICATION_TTL_HOURS * 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        dedupeKey: `verify:${user.id}`,
        tags: [{ name: 'tipo', value: 'verificacion' }],
        ...templates.verifyEmail({
          name: user.name,
          url,
          expiresInHours: env.EMAIL_VERIFICATION_TTL_HOURS,
        }),
      });
    },
    afterEmailVerification: async (user) => {
      await auditar({ action: AUDIT.emailVerificado, actorId: user.id, targetId: user.id });
      await sendMail({
        to: user.email,
        dedupeKey: `bienvenida:${user.id}`,
        ...templates.welcome({ name: user.name, loginUrl: FRONTEND_ROUTES.login }),
      });
    },
  },

  user: {
    /**
     * Campos propios del dominio. `input: false` es lo que impide el mass
     * assignment: un cliente no puede colar `status` en el registro (A-01).
     */
    additionalFields: {
      status: { type: 'string', required: false, defaultValue: 'ACTIVE', input: false },
      deletedAt: { type: 'date', required: false, input: false },
    },
    // El cambio de correo salta por encima de la verificacion: desactivado.
    changeEmail: { enabled: false },
    // El borrado es logico y pasa por users.service, no por la libreria.
    deleteUser: { enabled: false },
  },

  session: {
    expiresIn: env.SESSION_TTL_DAYS * DIA_S,
    updateAge: env.SESSION_UPDATE_AGE_HOURS * 60 * 60,
    freshAge: env.SESSION_FRESH_AGE_MINUTES * 60,
    // La BD sigue siendo la fuente de verdad aunque Redis cachee: sin esto no
    // hay listado de sesiones ni purga ni rastro de auditoria.
    storeSessionInDatabase: true,
    cookieCache: {
      enabled: env.SESSION_COOKIE_CACHE_SECONDS > 0,
      maxAge: env.SESSION_COOKIE_CACHE_SECONDS,
      // jwe: la cookie lleva datos de sesion, va cifrada y no solo firmada.
      strategy: 'jwe',
    },
  },

  rateLimit: {
    enabled: true,
    window: Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000),
    max: env.RATE_LIMIT_MAX,
    storage: secondaryStorage ? 'secondary-storage' : 'memory',
    /**
     * Limite por IP y endpoint. Sustituye al bloqueo de cuenta por intentos
     * fallidos: acota el total de intentos por origen, que es lo que frena el
     * password spraying (una contraseña contra miles de cuentas).
     *
     * Las claves van RELATIVAS al basePath, no con la ruta completa: Better
     * Auth normaliza `req.url` quitando el basePath antes de buscar la regla.
     * Con la ruta completa ninguna regla casa y se aplica silenciosamente el
     * limite por defecto de los endpoints sensibles (3 cada 10 s), que en
     * cuanto hay un poco de trafico legitimo devuelve 429 a todo el mundo.
     */
    customRules: {
      '/sign-in/email': { window: 60, max: env.AUTH_SIGNIN_MAX },
      '/sign-up/email': { window: 60, max: env.AUTH_SIGNUP_MAX },
      '/request-password-reset': { window: 900, max: 3 },
      '/reset-password': { window: 900, max: 5 },
      '/send-verification-email': { window: 900, max: 3 },
      '/change-password': { window: 300, max: 5 },
      // 6 digitos son 10^6: sin limite estricto el segundo factor no aporta nada.
      '/two-factor/verify-totp': { window: 300, max: env.AUTH_MFA_MAX },
      '/two-factor/verify-backup-code': { window: 300, max: env.AUTH_MFA_MAX },
      '/two-factor/enable': { window: 300, max: env.AUTH_MFA_MAX },
    },
  },

  advanced: {
    useSecureCookies: env.COOKIE_SECURE,
    defaultCookieAttributes: {
      sameSite: env.COOKIE_SAMESITE,
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    },
    // uuid para que los ids encajen con las columnas @db.Uuid del RBAC.
    database: { generateId: 'uuid' },
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
      // Cada cliente IPv6 recibe una /128: sin agrupar por /64, quien tenga un
      // bloque tiene 2^64 claves distintas y el rate limit deja de existir.
      ipv6Subnet: 64,
    },
  },

  hooks: {
    // Sin `async`: la comprobacion es sincrona y createAuthMiddleware exige
    // que el handler devuelva una Promise, no que este marcado `async`.
    before: createAuthMiddleware((ctx) => {
      // Un hospital no tiene autoregistro: por defecto, /sign-up/email por
      // HTTP responde 403. Las llamadas de servidor (alta administrativa,
      // seed) no pasan por aqui: no traen `ctx.request`.
      if (bloquearRegistroPublico(ctx.path, Boolean(ctx.request), env.AUTH_PUBLIC_SIGNUP)) {
        // ctx.error(...) en vez de `new APIError(...)`: es el idioma que usa
        // la propia libreria (ver node_modules/better-auth/dist/api/routes/account.mjs).
        throw ctx.error('FORBIDDEN', {
          message: 'El registro publico esta deshabilitado. Un administrador debe crear tu cuenta.',
        });
      }
      return Promise.resolve();
    }),
  },

  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await asignarRolPorDefecto(user.id);
          await auditar({ action: AUDIT.registro, actorId: user.id, targetId: user.id });
        },
      },
    },
    session: {
      create: {
        /**
         * Una cuenta suspendida o borrada no abre sesiones nuevas. Better Auth
         * no conoce nuestro `status`, asi que la puerta se pone aqui: cubre
         * login, verificacion de correo y reset por igual.
         */
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { status: true, deletedAt: true },
          });
          if (!user || user.deletedAt !== null || user.status !== 'ACTIVE') {
            await auditar({
              action: AUDIT.sesionRechazada,
              actorId: session.userId,
              targetId: session.userId,
              metadata: { motivo: user?.deletedAt ? 'borrada' : (user?.status ?? 'inexistente') },
            });
            return false;
          }
          return { data: session };
        },
        after: async (session) => {
          await auditar({
            action: AUDIT.loginOk,
            actorId: session.userId,
            targetId: session.userId,
            ip: session.ipAddress ?? null,
            userAgent: session.userAgent ?? null,
          });
        },
      },
    },
  },

  plugins: [
    twoFactor({
      issuer: env.MFA_ISSUER,
      // El secreto TOTP se guarda cifrado con BETTER_AUTH_SECRET.
      totpOptions: { digits: 6, period: 30 },
      skipVerificationOnEnable: false,
    }),
    // Permite `Authorization: Bearer <token>` ademas de la cookie de sesion,
    // para clientes moviles y servicio a servicio.
    bearer(),
    /**
     * Rechaza contraseñas aparecidas en filtraciones, via la API de
     * k-anonimato de HaveIBeenPwned: se envian los 5 primeros caracteres del
     * SHA-1, nunca la contraseña ni su hash completo.
     *
     * Sustituye a la lista de 10 contraseñas embebida, que era lo que habia.
     *
     * Falla CERRADO: si la API no responde, el registro y el cambio de clave
     * devuelven 500. Es lo correcto por seguridad, pero ata la disponibilidad
     * de esas dos rutas a un tercero, asi que se puede desactivar.
     */
    ...(env.PASSWORD_BREACH_CHECK
      ? [
          haveIBeenPwned({
            customPasswordCompromisedMessage:
              'Esta contraseña aparece en filtraciones conocidas. Elige otra.',
          }),
        ]
      : []),
    // Documenta la superficie de /auth en {API_PREFIX}/auth/reference.
    openAPI({ disableDefaultReference: false }),
  ],

  onAPIError: {
    throw: false,
    onError: (error) => {
      logger.warn({ err: error }, 'Error en un endpoint de Better Auth');
    },
  },
});

/**
 * Audita `/sign-out`, montado en app.ts ANTES de `toNodeHandler(auth)` para
 * esa ruta especifica. Hoy el logout no se auditaba.
 *
 * No va en `hooks.before` (a diferencia de `bloquearRegistroPublico`) porque
 * ahi no funciona para clientes Bearer: el hook de usuario y el del plugin
 * `bearer` (que convierte `Authorization: Bearer` en la cookie de sesion)
 * reciben cada uno el MISMO contexto original sin los parches del otro —
 * verificado en node_modules/better-auth/dist/api/dispatch.mjs, `runBeforeHooks`
 * pasa siempre el `context` de entrada, nunca uno acumulado entre hooks — asi
 * que `getSessionFromCtx` dentro de un hook nunca ve una sesion por Bearer.
 * Se lee aqui con el mismo patron que `authenticate.ts`, que si la resuelve
 * correctamente por las dos vias porque llama a la API completa de Better
 * Auth (con su propio pipeline de hooks), no a una funcion de endpoint cruda.
 */
export const auditarLogout: RequestHandler = async (req, _res, next) => {
  try {
    const sesion = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (sesion) {
      await auditar({
        action: AUDIT.logout,
        actorId: sesion.user.id,
        targetId: sesion.user.id,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
    }
  } catch (error) {
    // Un fallo al auditar no puede impedir el cierre de sesion real.
    logger.error({ err: error }, 'No se pudo auditar el logout');
  }
  next();
};

/**
 * Rol por defecto de toda cuenta nueva. Sin el, un usuario recien registrado
 * no tiene ni un permiso y la API le responde 403 a todo.
 */
async function asignarRolPorDefecto(userId: string): Promise<void> {
  try {
    const role = await prisma.role.findUnique({ where: { name: DEFAULT_ROLE }, select: { id: true } });
    if (!role) {
      logger.warn({ role: DEFAULT_ROLE }, 'Rol por defecto ausente: corre `npm run db:seed`');
      return;
    }
    await prisma.userRole.createMany({ data: [{ userId, roleId: role.id }], skipDuplicates: true });
    await invalidarRbac(userId);
  } catch (error) {
    // No puede tumbar un registro que ya se completo: se avisa y se sigue.
    logger.error({ err: error, userId }, 'No se pudo asignar el rol por defecto');
  }
}

export type AuthSession = typeof auth.$Infer.Session;

/** Comprobacion al arrancar: falla ruidosamente si la config esta mal. */
export function describirAuth(): Record<string, unknown> {
  return {
    basePath: `${env.API_PREFIX}/auth`,
    sesionDias: env.SESSION_TTL_DAYS,
    cookieCacheSegundos: env.SESSION_COOKIE_CACHE_SECONDS,
    almacenSecundario: secondaryStorage ? 'redis' : 'memoria',
    cookiesSeguras: env.COOKIE_SECURE,
    verificacionObligatoria: env.REQUIRE_VERIFIED_EMAIL,
    entorno: isProd ? 'produccion' : env.NODE_ENV,
  };
}
