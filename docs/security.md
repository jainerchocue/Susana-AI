# Seguridad — qué control vive dónde

Para reportar una vulnerabilidad: ver `SECURITY.md` en la raíz. Este
documento es el mapa técnico de controles, no el proceso de disclosure.

## Borde HTTP

| Control | Dónde vive |
|---|---|
| Helmet (CSP `'none'`, HSTS en prod, sin `x-powered-by`) | `src/app.ts` |
| CORS con origen concreto (nunca `*` con `credentials: true`) | `src/app.ts`, lista en `env.CORS_ORIGINS` |
| CSRF por origen, cierra en fallo, toda la API (no solo `/auth`) | `verificarOrigen`, `core/middleware/security.ts` |
| `415` si hay body y no es `application/json` | `requireJson`, `core/middleware/security.ts`, justo antes de `express.json()` |
| Límite de tamaño de body y timeouts HTTP | `env.BODY_LIMIT`, `HTTP_*_TIMEOUT_MS` |
| Sin compresión en respuestas `no-store` (mitiga BREACH) | `src/app.ts` |

## Rate limit — tres/cuatro niveles

| Nivel | Clave | Dónde |
|---|---|---|
| General de la API | IP (agrupada `/64` en IPv6) | `globalRateLimit`, excluye `/health` |
| Borde de `/auth/**` | **solo IP** (nunca `ip\|cuenta`: esa clave compuesta daba 1.000 cupos a una IP contra 1.000 cuentas y el password spraying pasaba entero) | `authRateLimit` |
| Por endpoint sensible de auth (`sign-in`, `2FA`, reset...) | IP, ventana propia | `rateLimit.customRules` en `core/auth/auth.ts`, rutas **relativas al basePath** |
| Asistente | usuario autenticado (cae a IP si no hay sesión) | `assistantRateLimit = limitePorUsuario('assistant', env.ASSISTANT_RATE_LIMIT_MAX)` |
| API interna del agente | IP | `internalRateLimit` |

Todos con `RedisStore` (`rate-limit-redis`): en memoria, N réplicas
multiplican por N el límite efectivo y cada despliegue lo resetea.

## Autenticación (Better Auth)

| Control | Dónde vive |
|---|---|
| Solo email + contraseña, TOTP opcional | `core/auth/auth.ts` — nada de OAuth social, magic link ni passkey |
| Hash scrypt con semáforo de concurrencia | `core/security/password.ts`, enchufado en `password.hash`/`verify` (el scrypt por defecto de la librería no tiene semáforo: 16 req/s congelaban el threadpool de libuv) |
| Cuenta suspendida no abre sesión nueva | hook `session.create.before` — Better Auth no conoce `status`, la puerta está aquí |
| `status`/`deletedAt` no llegan por mass assignment | `additionalFields` con `input: false` |
| Contraseñas filtradas rechazadas (k-anonimato HIBP) | plugin `haveIBeenPwned`, falla **cerrado** si la API no responde (`PASSWORD_BREACH_CHECK`) |
| 2FA con bloqueo por fuerza bruta | plugin `twoFactor` (`failedVerificationCount`, `lockedUntil`) |
| `CORS_ORIGINS` = `trustedOrigins` (CSRF + `callbackURL`/`redirectTo`) | un valor de más es un *open redirect* |
| Registro bloqueado por HTTP salvo `AUTH_PUBLIC_SIGNUP=true` | hook `hooks.before`, distingue llamada HTTP de llamada de servidor (`ctx.request`) |

## Autorización

Ver `docs/rbac.md` para el catálogo completo. Resumen: permisos
`recurso:accion`, comprobados **solo** en middleware
(`requirePermissions`/`requireRoles`/`requireOwnershipOr`), nunca en
controlador ni servicio; invariante de no-escalada en `core/rbac/guards.ts`
con las dos guardas de `setRoles()`.

## API interna del agente

Tres capas independientes, no una sola API key:

| Control | Dónde vive |
|---|---|
| Aislamiento de red | segundo proceso HTTP, `INTERNAL_HOST` (127.0.0.1 por defecto), nunca en el puerto público |
| Allowlist de IP/CIDR | `soloRedInterna`, `net.BlockList` construido una vez desde `INTERNAL_ALLOWED_IPS`; usa `req.socket.remoteAddress`, **nunca** `req.ip` ni `X-Forwarded-For` (serían falsificables) |
| Clave compartida | `requireInternalKey`: `sha256` de ambos lados + `crypto.timingSafeEqual`, nunca `===`; sin `INTERNAL_API_KEY` el puerto no arranca (cierra en fallo) |
| Rate limit propio | `internalRateLimit`, por IP |
| Dos claves, una por sentido | `AGENT_API_KEY` (Node→Python) y `INTERNAL_API_KEY` (Python→Node): filtrar una no habilita el sentido contrario |

mTLS **no** se implementa en el MVP — se documenta como pendiente, cubierto
por un sidecar/service mesh si hiciera falta más adelante (`// ponytail:`
explícito en el plan, fuera de alcance del hackathon).

## El agente sin autoridad

El diseño impide que Python toque SQL o vea el esquema real:

- **Catálogo lógico:** `describirParaAgente` solo expone nombres lógicos de
  dataset/dimensión/medida; tabla y columna física nunca salen de Node.
- **DSL cerrado:** `querySpecSchema` (Zod, `.strict()`) limita agregaciones,
  campos, operadores y tamaños de filtro; toda petición se valida además
  **semánticamente** contra el catálogo del usuario del ticket
  (`validarConsulta`) antes de tocar la base de datos.
- **SQL parametrizado:** `construirSql` usa `Prisma.sql`/`Prisma.raw` —
  identificadores (tabla/columna) **solo** del catálogo interno, nunca de la
  entrada; todo valor de usuario va como parámetro. Nada de
  `$queryRawUnsafe` ni concatenación.
- **Transacción de solo lectura:** `SET TRANSACTION READ ONLY` +
  `statement_timeout` por consulta (`AGENT_QUERY_TIMEOUT_MS`).
- **Tickets de un solo circuito:** 32 bytes aleatorios, TTL corto
  (`AGENT_TICKET_TTL_SECONDS`), cupo de consultas y ligados al usuario; solo
  se guarda su hash en Redis; se revocan al terminar la pregunta.
- **Respuesta de confianza mixta:** el texto de Python (`answer`) se valida
  con Zod y se acota (`≤4000` caracteres) pero **nunca** sustituye a las
  filas — esas las ejecuta y devuelve Node, no las que Python afirme.

## Privacidad de datos

| Control | Dónde vive |
|---|---|
| Nunca se devuelve la entidad de Prisma cruda | mappers (`toPublicUser`, `PublicAlert`, ...) |
| Hash de contraseña fuera de la API | vive en `Account.password`, nunca en `User` ni en ninguna respuesta |
| Datos interpolados en email escapados | `escapeHtml`, plantillas en `core/mail/templates/` |
| Auditoría append-only, con actor congelado | trigger de PostgreSQL + `actorEmail` grabado en `core/audit/audit.ts` |

Acciones auditadas relevantes para este dominio (T1):
`assistant.query`, `assistant.query.rejected`, `agent.internal.query`,
`agent.internal.denied`, `alert.updated`, `data.export`,
`data.sensitive.read` — además de las ya existentes (login, logout, cambios
de rol, etc.).

## Qué NO garantiza el diseño

Documentado con detalle en `CLAUDE.md` §15 y `SECURITY.md`; en corto:

- **No hay detección de reuso de token de sesión.** Better Auth no rota
  refresh tokens; uno robado sirve hasta que caduque o se revoque a mano.
- **No hay bloqueo de cuenta por intentos fallidos.** Lo sustituye el rate
  limit por IP y endpoint.
- **Revocar una sesión es inmediato en toda la API propia.** `authenticate`
  (`core/middleware/authenticate.ts`) llama a `auth.api.getSession` con
  `disableCookieCache: true`, así que ninguna ruta protegida por él (todo
  salvo `/auth/**`) lee la caché de cookie: un logout o una revocación se
  notan en la siguiente petición, no `SESSION_COOKIE_CACHE_SECONDS` segundos
  después. Esa variable solo sigue afectando a quien llame directamente al
  endpoint de Better Auth `GET {API_PREFIX}/auth/get-session` sin pedir
  `disableCookieCache=true` — algo que nuestro propio código no hace. El
  trade-off es una consulta extra a la tabla `sessions` por petición
  autenticada a cambio de esa revocación inmediata. Suspender un usuario
  también es inmediato, por la misma razón: se revalida contra la base de
  datos en cada petición.
- **mTLS entre Node y el puerto interno**, fuera del MVP (ver arriba).
- **Fase B (pendiente):** todo control de acceso sobre datos clínicos reales
  (por paciente, por servicio del HIS) depende de datos que aún no existen
  en el repo (`data/raw/`, bloqueado hasta perfilarlos).

## Antes de desplegar

- [ ] `BETTER_AUTH_SECRET` con entropía real (`openssl rand -base64 48`, ≥48 car.)
- [ ] `REDIS_URL` configurada (obligatoria: sin ella el rate limit no protege con >1 réplica)
- [ ] `COOKIE_SECURE=true`, `CORS_ORIGINS` solo con https y sin comodines
- [ ] `TRUST_PROXY` con el número real de saltos delante
- [ ] `SEED_ADMIN_PASSWORD` propia y 2FA activado en esa cuenta
- [ ] `AGENT_API_KEY` e `INTERNAL_API_KEY` generadas, distintas entre sí, y
      `INTERNAL_ALLOWED_IPS` acotada a la IP real del servicio Python
- [ ] `npm run audit:prod` limpio
- [ ] Decidido `PASSWORD_BREACH_CHECK` (falla cerrado si HaveIBeenPwned no responde)
