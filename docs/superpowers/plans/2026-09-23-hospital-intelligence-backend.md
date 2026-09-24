# Hospital Intelligence — Plan de implementación del backend

> **Para agentes:** lee **§0 Restricciones globales** y **tu tarea**. Nada más. `CLAUDE.md` es ley;
> este plan la complementa y nunca la contradice. Si encuentras una contradicción, PARA y repórtala.

**Objetivo:** convertir la plantilla (Express 5 + TS + Prisma/PostgreSQL + Better Auth + RBAC) en el
backend de *Hospital Intelligence*: API Gateway/BFF seguro para React y único intermediario con el
agente IA en Python.

**Arquitectura:** Node tiene toda la autoridad. Python solo *propone* consultas en un DSL JSON;
Node las valida contra un catálogo permitido por los permisos del usuario, las ejecuta con SQL
parametrizado en transacción de solo lectura y devuelve los datos. La API interna del agente vive
en un **segundo puerto** (127.0.0.1) que nunca se expone.

**Stack:** Node ≥22, Express 5, TypeScript strict, Prisma 6 + PostgreSQL, Zod 3, Better Auth, Pino,
Vitest + Supertest. **Sin dependencias nuevas.**

---

## Decisiones y desviaciones deliberadas respecto al prompt

| El prompt pide | Se hace | Motivo |
|---|---|---|
| JWT + refresh rotativo, `/auth/login|logout|refresh|me` | Better Auth (cookie o Bearer). login = `POST /auth/sign-in/email`, logout = `POST /auth/sign-out`, refresh = no existe (la sesión se renueva sola por `updateAge`), me = `GET /users/me` | CLAUDE.md §2 y §15 |
| Argon2id / bcrypt | scrypt con semáforo (`core/security/password.ts`) | CLAUDE.md §7 y §15 |
| `{success, data, meta, error:null}` | contrato de `api-response.ts` | CLAUDE.md §3 |
| Input inválido → 400 | 422 `VALIDATION_ERROR` (JSON malformado sí es 400) | contrato existente y sus tests |
| Carpetas `middleware/`, `repositories/`, `services/` | `core/` + `modules/<dominio>` | CLAUDE.md §1 |
| `requireAuth/requireRole/requirePermission` | `authenticate/requireRoles/requirePermissions` | ya existen |
| Clases `ValidationError`, `AgentError`… | `AppError` + nuevos `ErrorCode` y factorías | CLAUDE.md §10 |
| `GET /health`, `GET /ready` | `GET /api/v1/health`, `/api/v1/health/ready` (+ estado del agente) | ya existen fuera del rate limit |
| `roles:manage` | `roles:read/create/update/delete/assign-permissions` | granularidad existente (superconjunto) |
| ADMIN = "administración" | ADMIN tiene **todos** los permisos del catálogo, explícitos (no `*`) | invariante de no-escalada: sin ellos no podría asignar DIRECTOR/FARMACIA |
| `/internal/agent/query` | en el puerto interno `INTERNAL_PORT` (127.0.0.1), no en el público | restricción de red real, no solo API key |
| mTLS | no se implementa; se documenta con sidecar/service mesh | `// ponytail:` fuera del alcance del MVP |
| Registro de usuarios | `POST /auth/sign-up/email` bloqueado por HTTP salvo `AUTH_PUBLIC_SIGNUP=true`; las altas las hace un admin con `POST /users` | un hospital no tiene autoregistro |
| Filtrado por ámbito (alertas, datasets) | helper `core/rbac/alcance.ts`, llamado desde el controlador | CLAUDE.md §5 prohíbe *puertas* fuera del middleware; esto es filtrado por fila y la puerta sigue siendo `requirePermissions` |

---

## Arquitectura del agente (autoridad en Node)

```
React ──HTTPS──► Node :3000  POST /api/v1/assistant/query  (authenticate → validate → assistant:use → rate limit)
                   │ 1. datasets = catálogo ∩ permisos del usuario
                   │ 2. ticket = 32 bytes aleatorios, TTL 60 s, cupo N consultas, ligado al usuario
                   ▼
                 Python  POST {AGENT_URL}/v1/ask   X-Internal-Key: AGENT_API_KEY
                   │ recibe: pregunta, ticket, catálogo LÓGICO (sin tablas/columnas reales), límites
                   │ 3. propone 0..N consultas en DSL JSON
                   ▼
                 Node :3001 (127.0.0.1)  POST /internal/agent/query   X-Internal-Key: INTERNAL_API_KEY
                   │ 4. IP permitida → rate limit → clave → ticket válido y con cupo
                   │ 5. valida el DSL contra los datasets del USUARIO del ticket
                   │ 6. SQL parametrizado, identificadores solo del catálogo, tx READ ONLY, statement_timeout
                   │ 7. guarda el resultado bajo el ticket y lo devuelve a Python
                   ▼
                 Python devuelve {status, answer}  (texto no confiable, validado con Zod, ≤4000)
                   ▼
Node responde a React: answer + las filas que NODE ejecutó (no las que Python dice) · revoca el ticket · audita
```

Dos claves distintas (una por sentido): filtrar una no permite el sentido contrario. Python nunca
recibe credenciales de BD ni nombres físicos de tablas.

---

## §0 Restricciones globales (todas las tareas)

- `CLAUDE.md` completo es obligatorio: orden de middlewares, `ok/created/paginated`, `AppError`,
  Zod `.strict()`, `PERMISSIONS.x.y`, sin `any`, sin `as` para callar al compilador, sin `@ts-ignore`,
  imports relativos, comentarios en español explicando el porqué, `// ponytail:` en los atajos.
- **Sin dependencias nuevas.** Stdlib: `fetch`, `AbortSignal.timeout`, `crypto`, `net.BlockList`, `node:readline`.
- **Sin git**: no hagas commit, stash, checkout ni reset.
- **Solo tocas los archivos que tu tarea lista.** Excepción: `src/core/openapi/registry.ts`, donde solo
  añades tu bloque con `Edit`; si el `Edit` falla porque otro agente cambió el archivo, reléelo y reintenta.
- No ejecutes `npm install`, `npm run build`, `prisma migrate dev` ni `prisma generate` salvo que tu tarea lo diga.
- Base de datos de tests **propia de cada tarea** (ver tabla de olas). Para dejarla al día:
  `DATABASE_URL='postgresql://jhon@localhost:5432/<tu_db>?schema=public' npx prisma migrate deploy` y después
  `DATABASE_URL=… MAIL_ENABLED=false PASSWORD_BREACH_CHECK=false npx tsx prisma/seed.ts`.
  **Nunca `migrate reset`:** el guardián de Prisma para agentes IA lo bloquea sin consentimiento humano.
- Tests: `DATABASE_URL='postgresql://jhon@localhost:5432/<tu_db>?schema=public' npx vitest run <archivos>`.
- `npm run typecheck` y `npx eslint <tus archivos>`: arregla lo tuyo; si hay errores en archivos de
  otra tarea en curso, ignóralos y menciónalos en tu reporte.
- Nunca debilites una aserción existente para que un test pase. Si dudas, para y repórtalo.
- **Reporte final ≤ 200 palabras:** archivos tocados, comandos ejecutados con su resultado real
  (n.º de tests pasados/fallidos), desviaciones del plan y problemas abiertos. Sin volcar código.

## Olas

| Ola | Tarea | Modelo | BD de tests | Depende de |
|---|---|---|---|---|
| 1 | T1 Fundación | Sonnet 5 | `hospital_test` | — |
| 1 | T2 Documentación base | Sonnet 5 | — | — (en paralelo con T1) |
| 2 | T3 Alertas | Sonnet 5 | `hospital_test_a` | T1 |
| 2 | T4 Asistente + API interna | Sonnet 5 | `hospital_test_b` | T1 |
| 3 | T5 Integración y verificación | Sonnet 5 | `hospital_test` | T3, T4 |
| — | Revisión de seguridad de T4 + fase B | Opus 5.5 (planificación/revisión) | — | T5 |

---

## T1 — Fundación (piezas compartidas)

**Archivos**
- Modificar: `src/core/rbac/permissions.ts`, `prisma/seed.ts`, `src/config/constants.ts`,
  `package.json` (solo `name`/`description`), `src/config/env.ts`, `.env.example`, `tests/setup.ts`,
  `src/core/http/http-status.ts`, `src/core/http/errors.ts`, `src/core/audit/audit.ts`,
  `src/core/middleware/rate-limit.ts`, `src/core/middleware/security.ts`, `src/app.ts`,
  `src/core/auth/auth.ts`, `prisma/schema.prisma` (+ migración), `.gitignore`, `tests/helpers.ts`,
  `tests/security/escalada.test.ts` y `tests/unit/core.test.ts` (solo renombres de rol),
  `tests/security/auth.test.ts` (añadir casos)
- Crear: `src/core/rbac/alcance.ts`, `src/modules/alerts/alerts.constants.ts`, `tests/unit/fundacion.test.ts`

**1. Catálogo de permisos** (`permissions.ts`): conservar los existentes y añadir, con descripciones en `DESCRIPTIONS`:
```ts
system:      { manage: 'system:manage' },
dashboard:   { read: 'dashboard:read' },
analytics:   { read: 'analytics:read', export: 'analytics:export' },
assistant:   { use: 'assistant:use', advanced: 'assistant:advanced' },
medications: { read: 'medications:read', manage: 'medications:manage' },
alerts:      { read: 'alerts:read', manage: 'alerts:manage' },
services:    { read: 'services:read' },
surgeries:   { read: 'surgeries:read' },
```

**2. Roles de sistema.** `SYSTEM_ROLES` con clave = nombre. Se eliminan `superadmin`, `admin`, `user`.
`DEFAULT_ROLE = 'CONSULTA'`. Actualizar `prisma/seed.ts` (`SYSTEM_ROLES.SUPER_ADMIN`, texto de la auditoría del seed).

| Rol | Permisos |
|---|---|
| SUPER_ADMIN | `*` |
| ADMIN | todos los de `PERMISSION_LIST`, explícitos. Comentario: la no-escalada exige poseer lo que se asigna |
| DIRECTOR | dashboard.read, analytics.read, analytics.export, assistant.use, assistant.advanced, alerts.read, services.read, surgeries.read, medications.read |
| JEFE_SERVICIO | dashboard.read, analytics.read, assistant.use, alerts.read, alerts.manage, services.read, surgeries.read |
| FARMACIA | medications.read, medications.manage, alerts.read, alerts.manage, assistant.use |
| ANALISTA | dashboard.read, analytics.read, assistant.use, services.read, surgeries.read, medications.read |
| CONSULTA | dashboard.read |

`// ponytail:` en JEFE_SERVICIO: el "ámbito de su servicio" necesita la relación usuario↔servicio de los datos HIS (fase B).

**3. `src/core/rbac/alcance.ts`** (única lógica de comodín fuera de `authorize.ts`):
```ts
/** true si el conjunto contiene el permiso o el comodín. */
export function tienePermiso(permisos: ReadonlySet<string>, permiso: string): boolean
/** Claves de `mapa` cuyo permiso posee el usuario. Filtrado por fila, NO puerta de acceso. */
export function alcancesPorPermiso<T extends string>(permisos: ReadonlySet<string>, mapa: Readonly<Record<T, string>>): T[]
```

**4. `src/modules/alerts/alerts.constants.ts`**
```ts
export const ALERT_SCOPES = ['medication', 'service', 'triage', 'surgery'] as const;
export type AlertScope = (typeof ALERT_SCOPES)[number];
export const ALERT_TYPES = ['LOW_STOCK', 'HIGH_OCCUPANCY', 'LONG_WAIT', 'DEMAND_SPIKE', 'SURGERY_CANCELLATIONS'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export const ALERT_SCOPE_PERMISSION: Readonly<Record<AlertScope, string>> = {
  medication: PERMISSIONS.medications.read, service: PERMISSIONS.services.read,
  triage: PERMISSIONS.services.read, surgery: PERMISSIONS.surgeries.read,
};
```

**5. Modelo `Alert`** en `schema.prisma` (sección propia, comentarios en español):
```prisma
enum AlertSeverity { WARNING CRITICAL }
enum AlertStatus { OPEN ACKNOWLEDGED RESOLVED }
model Alert {
  id             String        @id @default(uuid()) @db.Uuid
  type           String        /// uno de ALERT_TYPES (validado en código)
  severity       AlertSeverity
  status         AlertStatus   @default(OPEN)
  scope          String        /// uno de ALERT_SCOPES
  scopeId        String?       /// código HIS (texto, sin FK: los datos se importan)
  metric         String
  value          Float
  threshold      Float
  message        String
  firstSeenAt    DateTime      @default(now())
  lastSeenAt     DateTime      @default(now())
  acknowledgedBy String?       @db.Uuid
  acknowledgedAt DateTime?
  resolvedAt     DateTime?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  @@index([status, severity, lastSeenAt(sort: Desc)])
  @@index([type, scopeId, status])
  @@index([scope, status])
  @@map("alerts")
}
```
`npx prisma migrate dev --name alerts` (usa `.env` → `hospital_dev`). Después `migrate reset --force` sobre
`hospital_dev`, `hospital_test`, `hospital_test_a` y `hospital_test_b` (los roles cambian de nombre; son BD nuevas).

**6. HTTP y errores.** `HttpStatus`: `UNSUPPORTED_MEDIA_TYPE: 415`, `BAD_GATEWAY: 502`, `GATEWAY_TIMEOUT: 504`.
`ErrorCode`: `UNSUPPORTED_MEDIA_TYPE`, `AGENT_UNAVAILABLE`, `AGENT_ERROR`, `QUERY_REJECTED`, `EXTERNAL_SERVICE_ERROR`.
Factorías de `AppError`:
```ts
static unsupportedMediaType(): AppError                                   // 415
static agentUnavailable(message = 'El asistente no esta disponible.'): AppError        // 503 AGENT_UNAVAILABLE
static agentError(message = 'El asistente devolvio una respuesta no valida.'): AppError // 502 AGENT_ERROR
static queryRejected(message: string, details?: ApiFieldError[]): AppError             // 422 QUERY_REJECTED
static externalService(message: string, status: 502 | 503 | 504 = 502): AppError       // EXTERNAL_SERVICE_ERROR
```

**7. `env.ts` + `.env.example`** (documentar cada una en `.env.example`):
```
AUTH_PUBLIC_SIGNUP            bool, default false
AGENT_URL                     url, opcional (sin ella /assistant responde 503)
AGENT_API_KEY                 string ≥32, opcional — Node → Python
INTERNAL_API_KEY              string ≥32, opcional — Python → Node (sin ella no arranca el puerto interno)
AGENT_TIMEOUT_MS              int, default 20000
AGENT_TICKET_TTL_SECONDS      int, default 60
AGENT_MAX_QUERIES_BASIC       int, default 2
AGENT_MAX_QUERIES_ADVANCED    int, default 5
AGENT_MAX_ROWS                int 1..1000, default 200
AGENT_QUERY_TIMEOUT_MS        int, default 5000
INTERNAL_HOST                 string, default 127.0.0.1
INTERNAL_PORT                 int, default 3001
INTERNAL_ALLOWED_IPS          csv de IP o CIDR, default "127.0.0.1,::1"
ASSISTANT_RATE_LIMIT_MAX      int, default 10   (por usuario y ventana RATE_LIMIT_WINDOW_MS)
INTERNAL_RATE_LIMIT_MAX       int, default 120
ALERT_LOW_STOCK_DAYS 7 · ALERT_CRITICAL_STOCK_DAYS 3 · ALERT_OCCUPANCY_PCT 85 · ALERT_CRITICAL_OCCUPANCY_PCT 95
ALERT_WAIT_MINUTES 60 · ALERT_DEMAND_SPIKE_PCT 30 · ALERT_SURGERY_CANCELLATION_PCT 15   (números positivos)
```
`superRefine`: con `AGENT_URL` exige `AGENT_API_KEY` e `INTERNAL_API_KEY` (todos los entornos); las dos
claves distintas; ninguna contiene `SECRETOS_PROHIBIDOS`; en producción, entropía suficiente en ambas.
`MFA_ISSUER` y `MAIL_FROM_NAME` por defecto `'Hospital Intelligence'`. `constants.ts`: `BRAND.name = 'Hospital Intelligence'`.
`tests/setup.ts` añade: `AUTH_PUBLIC_SIGNUP='true'`, `AGENT_URL='http://127.0.0.1:18765'`,
`AGENT_API_KEY='test-agent-key-0123456789abcdefghijklmnop'`, `INTERNAL_API_KEY='test-internal-key-0123456789abcdefghijklm'`,
`AGENT_TIMEOUT_MS='3000'`, `ASSISTANT_RATE_LIMIT_MAX='100000'`, `INTERNAL_RATE_LIMIT_MAX='100000'`.

**8. Auditoría** (`AUDIT`): `asistenteConsulta: 'assistant.query'`, `asistenteRechazo: 'assistant.query.rejected'`,
`agenteConsulta: 'agent.internal.query'`, `agenteDenegado: 'agent.internal.denied'`,
`alertaActualizada: 'alert.updated'`, `exportacion: 'data.export'`, `accesoSensible: 'data.sensitive.read'`.

**9. Rate limit** (`rate-limit.ts`):
```ts
/** Limitador por usuario autenticado (cae a IP si no hay req.auth). Exportado para poder testearlo con un max pequeño. */
export function limitePorUsuario(prefijo: string, max: number): RequestHandler
export const assistantRateLimit = limitePorUsuario('assistant', env.ASSISTANT_RATE_LIMIT_MAX);
export const internalRateLimit  // por IP, INTERNAL_RATE_LIMIT_MAX
```

**10. `requireJson`** (`security.ts`): POST/PUT/PATCH con cuerpo (`content-length > 0` o `transfer-encoding`)
y `!req.is('application/json')` → `AppError.unsupportedMediaType()`. En `app.ts`, justo antes de `express.json()`
(después del handler de Better Auth). Borrar `express.urlencoded(...)`: con `requireJson` es código muerto.

**11. Better Auth** (`auth.ts`), `hooks.before` con `createAuthMiddleware` (comprueba la ruta de import en `node_modules/better-auth`):
- `export function bloquearRegistroPublico(path: string, esHttp: boolean, permitido: boolean): boolean` →
  `path === '/sign-up/email' && esHttp && !permitido`; si es true, lanzar `APIError('FORBIDDEN', …)`.
  `esHttp = Boolean(ctx.request)`. **Verifica en el código fuente de better-auth** que `ctx.request` es
  `undefined` en las llamadas de servidor `auth.api.signUpEmail(...)` (las usan `users.service.create` y el seed).
- `/sign-out`: obtener la sesión (`getSessionFromCtx`) antes de que se destruya y `auditar({ action: AUDIT.logout, ... })`.
  Hoy el logout no se audita.

**12. Tests**
- Renombrar roles en `escalada.test.ts`/`core.test.ts` (`superadmin→SUPER_ADMIN`, `admin→ADMIN`, `user→CONSULTA`).
  CONSULTA ya no es un rol vacío (tiene `dashboard:read`): si un test asignaba `user` confiando en que no
  concedía nada, conserva su intención (p. ej. da `dashboard:read` al actor del test). Nunca relajes una aserción.
- `tests/helpers.ts`: `export async function crearUsuarioConRol(rol: string): Promise<UsuarioPrueba>` (registra, sustituye sus roles por ese rol de sistema, hace login).
- `tests/unit/fundacion.test.ts`: la matriz de `SYSTEM_ROLES` coincide exactamente con la tabla; todo permiso de un rol existe en `PERMISSION_LIST`; `ALERT_SCOPE_PERMISSION` solo usa permisos del catálogo; `tienePermiso`/`alcancesPorPermiso` (comodín, subconjunto, vacío); tabla de verdad de `bloquearRegistroPublico`.
- `tests/security/auth.test.ts`: `POST /api/v1/users` con `Content-Type: text/plain` y cuerpo → 415 `UNSUPPORTED_MEDIA_TYPE`; `POST /auth/sign-out` deja una fila `auth.logout`.

**Verificación (debe quedar todo verde):** `npm run lint`, `npm run typecheck`,
`DATABASE_URL=…/hospital_test npm test`, `npm run build`. Añade `data/` a `.gitignore` (fase B: datos HIS en `data/raw/`).

---

## T2 — Documentación base (en paralelo con T1)

**Archivos (solo estos):** `README.md` (reescribir), `docs/architecture.md`, `docs/rbac.md`, `docs/security.md`.
Fuente: `CLAUDE.md`, `SECURITY.md`, este plan (secciones de decisiones, arquitectura del agente, T1, T3, T4) y el código actual.
Español, directos, ≤200 líneas cada uno. No documentes nada que el plan no decida; marca la fase B como pendiente.

- **README:** qué es, arranque local (Postgres local o `docker compose`), `migrate reset` + seed, variables clave,
  scripts, mapa de endpoints (incluida la equivalencia de `/auth` de la tabla de decisiones), enlaces a `docs/`.
- **architecture.md:** capas `modules → core → config`, pipeline de middlewares de `app.ts` en orden, los dos
  puertos (público/interno), diagrama del flujo del agente, mapa de módulos (hechos y pendientes de fase B).
- **rbac.md:** catálogo de permisos, matriz de roles (tabla de T1), equivalencia con los nombres del prompt,
  por qué ADMIN tiene todos los permisos explícitos, invariante de no-escalada, filtrado por ámbito con
  `alcancesPorPermiso` (alertas y datasets del asistente), cómo añadir un permiso (catálogo → seed).
- **security.md:** tabla "control → dónde vive" (Helmet, CORS, CSRF por origen, 415, límites de cuerpo y timeouts,
  rate limit en tres niveles: auth por IP / general / asistente por usuario / interno), Better Auth, API interna
  (IP allowlist + clave con `timingSafeEqual` + rate limit + puerto aislado), el agente sin autoridad (DSL,
  catálogo lógico, SQL parametrizado, tx READ ONLY, `statement_timeout`, tickets), privacidad (mappers/DTO),
  auditoría, y lo que queda fuera (mTLS vía sidecar).

---

## T3 — Módulo de alertas y motor de reglas (ola 2)

**Archivos:** crear `src/modules/alerts/{alerts.routes.ts, alerts.controller.ts, alerts.service.ts,
alerts.schemas.ts, alerts.mapper.ts, alerts.engine.ts}`, `tests/modules/alerts.test.ts`; añadir bloque en `registry.ts`.
Consume de T1: `Alert`, `alerts.constants.ts`, `alcancesPorPermiso`, `PERMISSIONS.alerts`, `AUDIT.alertaActualizada`, `env.ALERT_*`.

**Motor (puro, sin Prisma):**
```ts
export type MetricKey = 'medication.daysOfInventory' | 'service.occupancyPct' | 'triage.waitMinutesP50'
  | 'service.demandChangePct' | 'surgery.cancellationPct';
export interface MetricPoint { metric: MetricKey; scope: AlertScope; scopeId: string | null; label: string; value: number | 'insufficient_data' }
export interface AlertCandidate { type: AlertType; severity: AlertSeverity; scope: AlertScope; scopeId: string | null;
  metric: MetricKey; value: number; threshold: number; message: string }
export interface Umbrales { lowStockDays: number; criticalStockDays: number; occupancyPct: number;
  criticalOccupancyPct: number; waitMinutes: number; demandSpikePct: number; surgeryCancellationPct: number }
export const UMBRALES: Umbrales; // desde env
export function evaluarReglas(puntos: MetricPoint[], umbrales: Umbrales = UMBRALES): AlertCandidate[]
```
| type | metric | WARNING si | CRITICAL si |
|---|---|---|---|
| LOW_STOCK | medication.daysOfInventory | `< lowStockDays` | `< criticalStockDays` |
| HIGH_OCCUPANCY | service.occupancyPct | `> occupancyPct` | `> criticalOccupancyPct` |
| LONG_WAIT | triage.waitMinutesP50 | `> waitMinutes` | `> 2 × waitMinutes` |
| DEMAND_SPIKE | service.demandChangePct | `> demandSpikePct` | — |
| SURGERY_CANCELLATIONS | surgery.cancellationPct | `> surgeryCancellationPct` | — |

Comparaciones estrictas (en el umbral exacto no hay alerta). `'insufficient_data'` nunca genera alerta.
Mensaje en español con la etiqueta, el valor (1 decimal) y el umbral.

**Servicio:**
```ts
export async function sincronizar(candidatos: AlertCandidate[], evaluadas: MetricKey[]):
  Promise<{ creadas: number; actualizadas: number; resueltas: number }>
export async function list(query: ListAlertsQuery, alcances: AlertScope[]):
  Promise<{ items: PublicAlert[]; limit: number; hasNext: boolean; nextCursor: string | null }>
export async function getById(id: string, alcances: AlertScope[]): Promise<PublicAlert>   // fuera de alcance → 404
export async function updateStatus(id: string, input: UpdateAlertInput, alcances: AlertScope[],
  actorId: string, meta: RequestMeta): Promise<PublicAlert>
```
`sincronizar`, en una `$transaction`: clave = (type, scopeId). Si existe OPEN/ACKNOWLEDGED con esa clave, actualiza
severity/value/threshold/message/lastSeenAt conservando el estado; si no, crea OPEN. Toda alerta OPEN/ACK cuya
`metric ∈ evaluadas` y cuya clave no esté entre los candidatos pasa a RESOLVED (`resolvedAt`).
`// ponytail:` sin índice único parcial; basta con un solo evaluador a la vez (el job de la fase B).
Transiciones: OPEN→ACKNOWLEDGED, OPEN→RESOLVED, ACKNOWLEDGED→RESOLVED; cualquier otra → 409.
ACK guarda `acknowledgedBy/At`. `updateStatus` audita `alert.updated` con `auditarEnTx` (metadata: from, to).
Paginación por cursor como `audit.service.ts`, orden `lastSeenAt desc, id desc`.

**Rutas** (`router.use(noStore, authenticate)`; orden de CLAUDE.md §5):
```
GET   /       validate({ query: listAlertsQuerySchema })                       requirePermissions(alerts.read)
GET   /:id    validate({ params: idParamSchema })                              requirePermissions(alerts.read)
PATCH /:id    validate({ params: idParamSchema, body: updateAlertSchema })     requirePermissions(alerts.manage)
```
El controlador calcula `alcancesPorPermiso(req.auth!.permissions, ALERT_SCOPE_PERMISSION)` y se lo pasa al servicio.
Esquemas `.strict()`: la query admite `cursor, limit (20, máx. 100), status, severity, type, scope`;
el body `{ status: 'ACKNOWLEDGED' | 'RESOLVED' }`.
Mapper `PublicAlert`: id, type, severity, status, scope, scopeId, metric, value, threshold, message, firstSeenAt,
lastSeenAt, acknowledgedAt, resolvedAt (fechas ISO). No expone `acknowledgedBy`.

**Tests** (`hospital_test_a`; alertas insertadas con Prisma):
motor (límites WARNING/CRITICAL de cada regla, umbral exacto sin alerta, insufficient_data); sincronizar
(crear → actualizar sin duplicar → resolver ausentes; una métrica no evaluada no se resuelve);
HTTP: 401 sin sesión; 403 CONSULTA; FARMACIA lista solo `medication`; FARMACIA `GET /:id` de una de servicio → 404;
PATCH con solo alerts.read → 403; FARMACIA ACK de una de medicamento → 200 y fila `alert.updated`;
RESOLVED→ACKNOWLEDGED → 409; status inválido → 422; campo desconocido en la query → 422.
Usa `crearUsuarioConRol('FARMACIA')`, etc.

---

## T4 — Asistente, API interna del agente y health (ola 2)

**Archivos:** crear `src/core/agent/client.ts`, `src/core/middleware/internal.ts`, `src/internal-app.ts`,
`src/modules/assistant/{assistant.routes.ts, assistant.controller.ts, assistant.service.ts, assistant.schemas.ts,
assistant.catalog.ts, assistant.query.ts, assistant.tickets.ts, assistant.internal.ts}`,
`tests/modules/assistant.test.ts`, `tests/security/agente.test.ts`; modificar `src/server.ts`,
`src/modules/health/health.routes.ts`; añadir bloque en `registry.ts` (solo la ruta pública; la interna **no** se documenta en el OpenAPI público).
Consume de T1: env `AGENT_*`/`INTERNAL_*`, `AppError.agent*`/`queryRejected`, `AUDIT.asistente*`/`agente*`,
`assistantRateLimit`, `internalRateLimit`, `requireJson`, `alcance.ts`, `ALERT_SCOPE_PERMISSION`.

**`core/agent/client.ts`** (genérico, no importa módulos):
```ts
export interface AgentCatalogEntry { dataset: string; description: string;
  dimensions: { name: string; type: 'string' | 'number' | 'date'; description: string }[];
  measures: { name: string; description: string }[] }
export interface AgentAskInput { question: string; ticket: string; catalog: AgentCatalogEntry[];
  limits: { maxQueries: number; maxRows: number }; requestId: string }
export interface AgentAnswer { status: 'ok' | 'cannot_answer'; answer: string }
export async function preguntarAgente(input: AgentAskInput): Promise<AgentAnswer>
export async function pingAgente(): Promise<'up' | 'down' | 'no configurado'>
```
`preguntarAgente`: `fetch POST {AGENT_URL}/v1/ask`, cabeceras `X-Internal-Key: AGENT_API_KEY` y `X-Request-Id`,
`AbortSignal.timeout(AGENT_TIMEOUT_MS)`. Sin `AGENT_URL` → `agentUnavailable`; timeout o error de red → `agentUnavailable`;
HTTP no-2xx o cuerpo que no pasa Zod (`{status, answer ≤4000}`) → `agentError`. Nunca loguees el cuerpo.
`pingAgente`: `GET {AGENT_URL}/health`, timeout 2000 ms.

**`core/middleware/internal.ts`:**
```ts
export const soloRedInterna: RequestHandler      // req.socket.remoteAddress (NUNCA req.ip ni X-Forwarded-For)
export const requireInternalKey: RequestHandler  // X-Internal-Key vs INTERNAL_API_KEY
```
`soloRedInterna`: `net.BlockList` construido una vez desde `INTERNAL_ALLOWED_IPS` (IP → `addAddress`, CIDR → `addSubnet`);
normaliza `::ffff:a.b.c.d` a IPv4 antes de comprobar; si no está → 403.
`requireInternalKey`: `sha256` de ambas y `crypto.timingSafeEqual`; sin `INTERNAL_API_KEY` → 503 (cierra en fallo);
ausente o incorrecta → 401.

**`src/internal-app.ts`:** `export function createInternalApp(): Express` en este orden:
`trust proxy = false` → `requestContext` → `pinoHttp` → `helmet()` → `soloRedInterna` → `internalRateLimit` →
`requireInternalKey` → `requireJson` → `express.json({ limit: '64kb' })` → `app.use('/internal/agent', internalRouter)` →
`notFoundHandler` → `errorHandler`. Comentario: la API interna no pasa por el autoload a propósito, porque nunca debe
montarse en el puerto público.
**`server.ts`:** si hay `INTERNAL_API_KEY`, escucha en `INTERNAL_HOST:INTERNAL_PORT` con los mismos timeouts; si no,
`logger.warn` y no arranca. El apagado cierra ambos servidores.
**Health:** `/ready` añade `checks.agent = await pingAgente()`. No cambia `listo`: sin agente la API sigue sirviendo el resto.
`status` pasa a `'ready' | 'degraded'` (`degraded` si el agente está `down`); sigue siendo 200.

**Catálogo** (`assistant.catalog.ts`):
```ts
export interface Dimension { column: string; type: 'string' | 'number' | 'date'; description: string }
export interface Measure { column: string; description: string }
export interface Dataset { key: string; table: string; description: string; permission: string;
  dimensions: Record<string, Dimension>; measures: Record<string, Measure>;
  rowFilter?: { column: string; permitidos: (permisos: ReadonlySet<string>) => string[] } }
export const DATASETS: Readonly<Record<string, Dataset>>
export function datasetsPara(permisos: ReadonlySet<string>): Dataset[]
export function describirParaAgente(datasets: Dataset[]): AgentCatalogEntry[] // solo nombres LÓGICOS; nunca table/column
```
Fase A: un único dataset, `alerts` (tabla `alerts`, permiso `alerts.read`). Dimensiones: `type`, `severity`, `status`,
`scope`, `scope_id→scopeId`, `first_seen_at→firstSeenAt (date)`, `last_seen_at→lastSeenAt (date)`. Medidas: `value`,
`threshold`. `rowFilter: { column: 'scope', permitidos: (p) => alcancesPorPermiso(p, ALERT_SCOPE_PERMISSION) }`.
Al cargar el módulo, comprueba que cada clave lógica casa con `/^[a-z][a-z0-9_]{0,62}$/` y cada table/column con
`/^[A-Za-z_][A-Za-z0-9_]*$/`; si no, lanza al arrancar.

**DSL** (`assistant.schemas.ts`, todo `.strict()`):
```ts
const campo = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
export const querySpecSchema = z.object({
  dataset: campo,
  metrics: z.array(z.object({ agg: z.enum(['count', 'count_distinct', 'sum', 'avg', 'min', 'max']), field: campo.optional() }).strict()).min(1).max(5),
  groupBy: z.array(z.object({ field: campo, grain: z.enum(['day', 'week', 'month', 'year']).optional() }).strict()).max(3).default([]),
  filters: z.array(z.object({ field: campo, op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'between', 'contains']),
    value: z.union([z.string().max(200), z.number().finite(), z.boolean(),
      z.array(z.union([z.string().max(200), z.number().finite()])).min(1).max(50)]) }).strict()).max(10).default([]),
  orderBy: z.array(z.object({ ref: z.string().regex(/^(metric:[0-4]|[a-z][a-z0-9_]{0,62})$/), dir: z.enum(['asc', 'desc']).default('desc') }).strict()).max(3).default([]),
  limit: z.number().int().min(1).max(1000).default(100),
}).strict();
export const askSchema = z.object({ question: z.string().trim().min(3).max(500) }).strict();
export const internalQuerySchema = z.object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/), query: querySpecSchema }).strict();
```

**Validación semántica y SQL** (`assistant.query.ts`):
```ts
export interface ConsultaValidada { dataset: Dataset; spec: QuerySpec }
export function validarConsulta(spec: QuerySpec, datasets: Dataset[], maxRows: number): ConsultaValidada
export function construirSql(c: ConsultaValidada, permisos: ReadonlySet<string>): Prisma.Sql
export interface ResultadoConsulta { columns: string[]; rows: Record<string, string | number | boolean | null>[]; rowCount: number; truncated: boolean }
export async function ejecutarConsulta(c: ConsultaValidada, permisos: ReadonlySet<string>): Promise<ResultadoConsulta>
```
Reglas de `validarConsulta` (si falla: `AppError.queryRejected` con `details` por campo):
dataset ∉ datasets permitidos → "Dataset desconocido o no permitido" (mismo mensaje en ambos casos: no enumera);
`count` no lleva field; `count_distinct` exige una dimensión; `sum/avg/min/max` exigen una medida;
groupBy solo sobre dimensiones y `grain` solo en las de tipo date; filtros sobre dimensión o medida, con op
compatible con el tipo (`contains` solo en string; `gt/gte/lt/lte/between` en number/date; `between` = array de 2;
`in` = array); valores de fecha ISO parseables; `orderBy.ref` = `metric:i` con i < nº de métricas, o un campo de groupBy;
`limit ≤ maxRows`.
Reglas de `construirSql`: identificadores **solo** del catálogo, con `Prisma.raw('"' + column + '"')`; **todo valor**
como parámetro `${}` de `Prisma.sql`; `Prisma.join` para listas. Dimensiones string → `"col"::text` (así los enums
comparan con parámetros de texto). grain → `date_trunc(${grain}, "col")`. `GROUP BY` y `ORDER BY` por posición ordinal
(números generados por el código): un mismo parámetro repetido en SELECT y GROUP BY no casa en Postgres.
Agregados: `COUNT(*)::int`, `COUNT(DISTINCT x)::int`, `SUM/AVG(x)::float8`, `MIN/MAX(x)`. Alias de salida: nombre lógico
de la dimensión y `${agg}_${field ?? 'all'}`. `in` → `= ANY(${array})`. `contains` → `ILIKE ${'%' + escapado + '%'}`,
escapando `\`, `%` y `_`. `rowFilter` → `AND "col"::text = ANY(${permitidos})`; si la lista está vacía → `AND FALSE`.
`LIMIT ${limit + 1}` para calcular `truncated`.
`ejecutarConsulta`: `prisma.$transaction(async (tx) => { SET TRANSACTION READ ONLY; SELECT set_config('statement_timeout', ${String(ms)}, true); consulta })`,
con timeout de la tx = `AGENT_QUERY_TIMEOUT_MS + 1000`. Normaliza filas: Date → ISO, bigint → number.

**Tickets** (`assistant.tickets.ts`, sobre `cache` de `core/cache/redis.ts`):
```ts
export interface Ticket { userId: string; permissions: string[]; requestId: string; maxQueries: number; maxRows: number }
export async function emitirTicket(t: Ticket): Promise<string>          // randomBytes(32).toString('base64url'); clave agent:ticket:<sha256hex>, TTL AGENT_TICKET_TTL_SECONDS
export async function usarTicket(ticket: string): Promise<Ticket>       // inexistente/caducado → 401 TOKEN_INVALID; supera maxQueries → 403
export async function guardarResultado(ticket: string, r: { query: QuerySpec } & ResultadoConsulta): Promise<void>
export async function leerResultados(ticket: string): Promise<Array<{ query: QuerySpec } & ResultadoConsulta>>
export async function revocarTicket(ticket: string): Promise<void>
```
Se guarda solo el hash del ticket. El contador de usos puede ir con get+set y un `// ponytail:` sobre la carrera (como mucho
1 consulta de más dentro del TTL), o con `cache.incr` si fija TTL (compruébalo en `redis.ts`).

**Servicio** (`assistant.service.ts`):
```ts
export interface RespuestaAsistente { status: 'ok' | 'cannot_answer'; answer: string;
  queries: Array<{ query: QuerySpec } & ResultadoConsulta> }
export async function preguntar(input: AskInput, actor: Actor, avanzado: boolean, meta: RequestMeta): Promise<RespuestaAsistente>
export async function consultaInterna(input: InternalQueryInput): Promise<ResultadoConsulta>
```
`preguntar`: datasets = `datasetsPara(actor.permissions)` (vacío → 403 `INSUFFICIENT_PERMISSIONS`); límites según
`avanzado` (el controlador lo calcula con `tienePermiso(req.auth!.permissions, PERMISSIONS.assistant.advanced)`);
emitir ticket → `preguntarAgente` → `leerResultados` → `revocarTicket` en `finally` → `auditar(assistant.query)` con
metadata `{ question (≤500), status, datasets usados, nQueries, nRows }`. Si el agente falla: `auditar(assistant.query.rejected, { code })` y relanzar.
`consultaInterna`: `usarTicket` → `validarConsulta` con los datasets del usuario del ticket (si rechaza:
`auditar(agent.internal.denied, actorId = userId del ticket)` y relanzar) → `ejecutarConsulta` → `guardarResultado` →
`auditar(agent.internal.query, { dataset, rowCount, requestId del ticket })`.

**Rutas.** Pública (`assistant.routes.ts`, autoload → `/api/v1/assistant`):
`router.use(noStore)`; `POST /query`: `authenticate, validate({ body: askSchema }), requirePermissions(PERMISSIONS.assistant.use), assistantRateLimit, controller.ask`.
Interna (`assistant.internal.ts`, **no** acaba en `.routes.ts`, así que el autoload no la monta): `POST /query`:
`validate({ body: internalQuerySchema }), controller.internalQuery`.

**Tests.** Stub de Python con `node:http` en `127.0.0.1:18765` (`AGENT_URL` de `tests/setup.ts`): comprueba
`X-Internal-Key`, lee el ticket y llama a `request(createInternalApp()).post('/internal/agent/query')` según el
escenario del test.
- `tests/modules/assistant.test.ts` (`hospital_test_b`): 401 sin sesión; 403 CONSULTA; 422 pregunta vacía o campo extra;
  flujo feliz con FARMACIA (2 alertas de medicamento + 1 de servicio sembradas; count por severity → las filas vienen de
  la BD y solo cuentan las 2 de medicamento); dataset inexistente → la llamada interna da 422 y queda `agent.internal.denied`;
  cupo básico: la 3.ª consulta con el mismo ticket → 403; ticket revocado tras responder → 401; stub con 500 → 502,
  stub que no responde → 503, JSON inválido → 502; fila `assistant.query` escrita.
- `tests/security/agente.test.ts` (sobre `createInternalApp()`): sin clave o con clave incorrecta → 401; ticket
  inexistente → 401; inyección: `value: "' OR 1=1 --"` y `"x'; DROP TABLE users; --"` → 200 con 0 filas y `users`
  intacta; `field: "type; drop"` → 422; dataset `pg_user` → 422; groupBy sobre una columna no expuesta
  (`acknowledged_by`) → 422; `contains: "%"` no devuelve todo; `construirSql(...).sql` no contiene ningún valor del
  usuario (todos están en `.values`); `soloRedInterna` con `remoteAddress = '10.0.0.5'` → 403 y con
  `'::ffff:127.0.0.1'` → pasa; `Content-Type: text/plain` → 415.

---

## T5 — Integración y verificación (ola 3)

Dueño único del repo en esta ola: puede tocar cualquier archivo para corregir.
- `tests/security/rbac-matriz.test.ts`: los 7 roles × endpoints (`GET /users`, `POST /users`, `GET /roles`,
  `GET /permissions`, `GET /audit`, `GET /alerts`, `PATCH /alerts/:id`, `POST /assistant/query`) → la matriz esperada,
  derivada de la tabla de T1 (permitido = no 401/403; denegado = 403); sin sesión → 401 en todos. Datos: tabla
  declarativa `{ endpoint, permiso }`; lo esperado se calcula desde `SYSTEM_ROLES`, no se escribe a mano.
- `tests/security/rate-limit.test.ts`: `limitePorUsuario('t', 2)` en una app Express mínima → la 3.ª petición da 429
  `RATE_LIMITED`; dos usuarios distintos tienen cupos independientes.
- OpenAPI: `GET /api/v1/openapi.json` incluye `/alerts` y `/assistant/query` y **no** incluye `/internal`.
- Docs: `docs/api.md` (endpoints desde el registro, equivalencias de `/auth`, contrato de respuesta, códigos de
  error), `docs/agent-integration.md` (contrato para el equipo de Python: ejemplos JSON de `/v1/ask`, `/health` y
  `/internal/agent/query`, especificación del DSL, límites, errores, reglas de seguridad y pseudocódigo del bucle de
  herramientas), `docs/database.md` (tablas de la fase A: identidad, RBAC, auditoría, alertas; la fase B, pendiente).
- Lista de CLAUDE.md §14 para `alerts` y `assistant`.
- Verificación completa: `npm run lint` (0 errores), `npm run typecheck`, `migrate reset` de `hospital_test` +
  `npm test`, `npm run build`, `npm run audit:prod`. Reporta las cifras reales.

---

## Fase B — datos HIS

Desbloqueada el 2026-09-23 con los archivos en `data/raw/`. Plan detallado y hallazgos del análisis:
[`2026-09-23-fase-b-datos-his.md`](2026-09-23-fase-b-datos-his.md).
