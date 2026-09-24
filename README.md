# Hospital Intelligence — Backend

API Gateway/BFF para el hackathon *Hospital Intelligence*: sirve al frontend en
React y es el **único** intermediario autorizado con el agente IA en Python.
Node tiene toda la autoridad — el agente solo *propone* consultas en un DSL
JSON que Node valida, ejecuta y audita. Detalle completo en
[`docs/architecture.md`](docs/architecture.md).

Stack: Node ≥22, Express 5, TypeScript strict, Prisma 6 + PostgreSQL, Zod 3,
Better Auth, Pino, Vitest + Supertest. Autenticación solo por credenciales
(email + contraseña, TOTP opcional); autorización propia por permisos
(`recurso:accion`) con guardas de no-escalada — ver
[`docs/rbac.md`](docs/rbac.md) y [`docs/security.md`](docs/security.md).

> Estado del repo: `users`, `roles`, `permissions`, `audit`, `health`,
> `alerts` (motor de reglas conectado a las métricas reales, job periódico +
> `POST /alerts/evaluate`), `assistant` (agente + API interna, 5 datasets),
> `dashboard`, `analytics`, `medications`, `surgeries` y los datos reales del
> HIS (`his_*`, importados en `hospital_local`) están implementados. Detalle
> completo en `docs/architecture.md` y `docs/database.md`.

---

## Arranque local en 5 comandos

```bash
cp .env.example .env && echo "BETTER_AUTH_SECRET=$(openssl rand -base64 48)" >> .env
docker compose up -d postgres redis   # o un Postgres/Redis locales
npm install
npm run db:migrate && npm run db:seed:dev   # migra, siembra permisos/roles/superadmin/usuarios de prueba
npm run dev                                  # API pública :3000 + API interna del agente :3001
```

El seed exige un `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` propios en
producción: el valor de ejemplo está publicado en este repositorio y el
arranque lo rechaza. Sin `AGENT_URL` el asistente responde `503` (no hace
falta Python corriendo para trabajar en el resto de la API); para probarlo en
local sin el agente real, `npm run agent:mock` (puerto 8000) implementa el
mismo contrato con datos de ejemplo — ver `docs/agent-integration.md`.

Los datos clínicos reales del HIS (dashboard, ocupación, medicamentos,
cirugías, asistente) no vienen en el seed: se importan aparte, una vez que
los archivos del extracto están en `data/raw/*.txt` (carpeta ignorada por
git):

```bash
npm run data:import      # idempotente: relanzarlo no duplica nada
npm run test:real        # opcional: verifica los conteos contra los archivos crudos
```

Guía completa de arranque de los 3 procesos (API, agente simulado, React),
usuarios de prueba y qué pantalla usa qué endpoint: **`docs/frontend.md`**.

---

## Variables de entorno clave

Lista completa y comentada en `.env.example` (falla al arrancar si algo
falta o es inseguro). Las específicas de este dominio:

| Variable | Qué hace |
|---|---|
| `AUTH_PUBLIC_SIGNUP` | `false` por defecto: un hospital no tiene autoregistro. Las altas las hace un admin (`POST /users`) |
| `AGENT_URL` | URL del servicio Python. Sin ella, `/assistant/query` responde `503` |
| `AGENT_API_KEY` / `INTERNAL_API_KEY` | claves del canal Node↔Python, una por sentido. Sin `INTERNAL_API_KEY` el puerto interno no arranca |
| `AGENT_TIMEOUT_MS`, `AGENT_QUERY_TIMEOUT_MS` | timeouts de red y de la consulta SQL del agente |
| `AGENT_MAX_QUERIES_BASIC/ADVANCED`, `AGENT_MAX_ROWS` | cupos por ticket, según tenga el usuario `assistant:advanced` |
| `INTERNAL_HOST`, `INTERNAL_PORT`, `INTERNAL_ALLOWED_IPS` | puerto interno (127.0.0.1 por defecto) y su allowlist de IP/CIDR |
| `ASSISTANT_RATE_LIMIT_MAX` / `INTERNAL_RATE_LIMIT_MAX` | límites del asistente (por usuario) y de la API interna (por IP) |
| `ALERT_LOW_STOCK_DAYS`, `ALERT_OCCUPANCY_PCT`, `ALERT_WAIT_MINUTES`, ... | umbrales del motor de reglas de alertas |

---

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga en caliente |
| `npm run lint` / `npm run typecheck` | 0 errores es el criterio |
| `npm test` | Suite completa (necesita PostgreSQL) |
| `npm run build` | Compila a `dist/` |
| `npm run audit:prod` | Falla si hay CVE alta en dependencias **de producción** |
| `npm run db:migrate` | Crea y aplica migración |
| `npm run db:seed:dev` | Siembra permisos, roles y superadmin |
| `npm run db:purge` | Borra sesiones y verificaciones caducadas |
| `npm run db:studio` | Explorador de la base de datos |

---

## Mapa de endpoints

### Autenticación — los sirve Better Auth

No hay `modules/auth/`; toda `{API_PREFIX}/auth/**` la sirve Better Auth desde
`core/auth/auth.ts`. Contrato completo y vivo en **`GET /api/v1/auth/reference`**
(no se duplica a mano en `openapi.json`: copiarlo garantizaría que mienta el
día que la librería cambie). Equivalencia con nombres de JWT clásicos:

| Método | Ruta | Equivale a |
|---|---|---|
| POST | `/api/v1/auth/sign-up/email` | registro (bloqueado salvo `AUTH_PUBLIC_SIGNUP=true`) |
| POST | `/api/v1/auth/sign-in/email` | login |
| POST | `/api/v1/auth/sign-out` | logout |
| GET | `/api/v1/auth/get-session` | sesión actual |
| — | (no existe) | *refresh*: la sesión se renueva sola (`updateAge`), no hay token rotativo |
| GET | `/api/v1/users/me` | *me* |
| POST | `/api/v1/auth/two-factor/verify-totp` | segundo paso del login (MFA) |

### Negocio — nuestros, en `openapi.json`

| Método | Ruta | Permiso |
|---|---|---|
| GET / PATCH | `/api/v1/users/me` | sesión |
| GET / POST | `/api/v1/users` | `users:read` / `users:create` |
| GET / PATCH / DELETE | `/api/v1/users/:id` | `users:*` |
| PUT | `/api/v1/users/:id/roles` | `users:assign-roles` |
| GET / POST / PATCH / DELETE | `/api/v1/roles` | `roles:*` |
| PUT | `/api/v1/roles/:id/permissions` | `roles:assign-permissions` |
| GET | `/api/v1/permissions` | `permissions:read` |
| GET | `/api/v1/audit` | `audit:read` |
| GET / GET / PATCH / POST | `/api/v1/alerts`, `/:id`, `/:id`, `/evaluate` | `alerts:read` / `alerts:read` / `alerts:manage` / `alerts:manage` |
| POST | `/api/v1/assistant/query` | `assistant:use` |
| GET | `/api/v1/dashboard/summary` · `/occupancy` · `/wait-times` · `/demand` | `dashboard:read` (+ `services:read` en las tres últimas) |
| GET | `/api/v1/analytics/services` · `/triage` (+ `/export`) | `analytics:read` + `services:read` (+ `analytics:export` en los export) |
| GET / PUT | `/api/v1/medications`, `/critical`, `/consumption`, `/:code/stock` | `medications:read` / `medications:manage` |
| GET | `/api/v1/analytics/surgeries` (+ `/export`) | `analytics:read` + `surgeries:read` (+ `analytics:export`) |
| GET | `/api/v1/health` · `/ready` · `/startup` | público |

El asistente y las alertas filtran, además del permiso, por **ámbito**: un
`FARMACIA` con `alerts:read` solo ve alertas de tipo `medication` (ver
`docs/rbac.md`). Todos los endpoints de dashboard/analítica/medicamentos/
cirugías, con permisos, parámetros y un ejemplo de respuesta real: `docs/api.md`.

### API interna del agente — no es pública

`POST /internal/agent/query` vive en un **segundo puerto** (127.0.0.1,
`INTERNAL_PORT`), protegido por IP allowlist + clave + rate limit propio.
Nunca se monta en el puerto público ni se documenta en `openapi.json`.
Contrato completo para el equipo de Python: `docs/agent-integration.md`.
Diseño de seguridad: `docs/security.md`.

---

## Cómo autenticarse

**Web (cookie).** El login deja una cookie httpOnly. Toda petición que cambie
estado necesita `Origin` (defensa CSRF, rechaza si falta):

```bash
curl -c cookies.txt -X POST localhost:3000/api/v1/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@hospital-intelligence.dev","password":"..."}'

curl -b cookies.txt -H 'Origin: http://localhost:5173' \
  -X PATCH localhost:3000/api/v1/users/me \
  -H 'Content-Type: application/json' -d '{"name":"Nuevo"}'
```

**Móvil o servicio a servicio (Bearer).** El login devuelve el token en la
cabecera `set-auth-token`; sin cookies no hay vector CSRF y no hace falta
`Origin`:

```bash
TOKEN=$(curl -si -X POST localhost:3000/api/v1/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@hospital-intelligence.dev","password":"..."}' \
  | awk -F': ' '/^set-auth-token/{print $2}' | tr -d '\r')

curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/v1/users/me
```

---

## Usuarios de prueba

`npm run db:seed:dev` con `SEED_TEST_USERS=true` (por defecto en desarrollo;
`env.ts` lo prohíbe en producción) crea, ya verificados:

| Correo (por defecto) | Rol | Contraseña |
|---|---|---|
| el de `SEED_ADMIN_EMAIL` | `SUPER_ADMIN` | la de `SEED_ADMIN_PASSWORD` |
| `director@hospital.test` | `DIRECTOR` | la de `SEED_TEST_PASSWORD` |
| `farmacia@hospital.test` | `FARMACIA` | la de `SEED_TEST_PASSWORD` |

Qué ve cada uno, pantalla a pantalla: `docs/frontend.md`. Nota importante
para la demo: **Resend en modo sandbox solo entrega correos a la dirección de
la propia cuenta de Resend** (sin dominio verificado); mientras eso no
cambie, como mucho un usuario de prueba podrá recibir correos reales.

---

## Añadir un módulo

Crea `src/modules/<dominio>/` con `routes`, `controller`, `service`,
`schemas` (y `mapper` si expone entidades con campos sensibles). El archivo
`*.routes.ts` se monta solo; el prefijo sale del nombre de la carpeta.
Declara los permisos nuevos en `core/rbac/permissions.ts` y siembra con
`npm run db:seed:dev`. **No** crees `modules/auth/`: esa superficie es de
Better Auth y se configura en `core/auth/auth.ts`.

---

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/frontend.md`](docs/frontend.md) | guía para React: arranque de los 3 procesos, cliente de Better Auth, contrato y errores, usuarios de prueba, pantalla a pantalla |
| [`docs/architecture.md`](docs/architecture.md) | capas, pipeline de middlewares, los dos puertos, flujo del agente |
| [`docs/rbac.md`](docs/rbac.md) | catálogo de permisos, matriz de roles, invariante de no-escalada |
| [`docs/security.md`](docs/security.md) | qué control vive dónde, qué queda fuera de alcance |
| [`docs/api.md`](docs/api.md) | todos los endpoints (desde el registro OpenAPI), permisos y ejemplos de respuesta reales |
| [`docs/agent-integration.md`](docs/agent-integration.md) | contrato para el equipo de Python: `/v1/ask`, `/health`, `/internal/agent/query`, DSL, catálogo de 5 datasets y límites |
| [`docs/database.md`](docs/database.md) | modelo completo: identidad, RBAC, auditoría, alertas y los datos reales del HIS (`his_*`) |
| [`SECURITY.md`](SECURITY.md) | cómo reportar una vulnerabilidad |

---

## Antes de desplegar

Checklist completa en `docs/security.md`. En corto: `BETTER_AUTH_SECRET` con
entropía real, `REDIS_URL` obligatoria, `COOKIE_SECURE=true`, `CORS_ORIGINS`
solo con https, `TRUST_PROXY` con el número real de saltos, y las claves del
agente (`AGENT_API_KEY`/`INTERNAL_API_KEY`) rotadas y distintas entre sí.
