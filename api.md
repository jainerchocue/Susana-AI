# API

Prefijo de toda ruta propia: `API_PREFIX` (`/api/v1` en desarrollo y en los
ejemplos de abajo). El contrato ejecutable es
**`GET /api/v1/openapi.json`**, generado en `core/openapi/openapi.ts` a partir
de `core/openapi/registry.ts` y de los MISMOS schemas de Zod que usa
`validate()`: no puede desincronizarse del código porque no hay una copia
separada que mantener a mano. Este documento es la versión legible de ese
mismo registro — si difieren, el JSON manda.

Los ejemplos de respuesta de este documento son **reales**: capturados contra
`hospital_local` (los datos importados del HIS, fecha de referencia
2026-09-21) con `PORT=3100 INTERNAL_PORT=3101 npm run dev`. Los arrays largos
están recortados a 2–3 elementos; el resto de campos es exactamente lo que
devuelve el servidor.

---

## Autenticación — `/auth/**` (Better Auth)

No existe `modules/auth/`: toda `{API_PREFIX}/auth/**` la sirve Better Auth
desde `core/auth/auth.ts`, montada a mano en `app.ts` antes de
`express.json()`. Su propio contrato vive en
**`GET /api/v1/auth/reference`** (plugin `openAPI` de la librería) y tampoco
se copia aquí. Equivalencia con nombres de JWT clásicos:

| Método | Ruta | Equivale a |
|---|---|---|
| POST | `/auth/sign-up/email` | registro (bloqueado por HTTP salvo `AUTH_PUBLIC_SIGNUP=true`; las altas normales las hace un admin con `POST /users`) |
| POST | `/auth/sign-in/email` | login |
| POST | `/auth/sign-out` | logout (auditado: ver `docs/architecture.md`) |
| GET | `/auth/get-session` | sesión actual |
| POST | `/auth/two-factor/verify-totp` | segundo paso del login (MFA) |
| — | *(no existe)* | *refresh*: la sesión se renueva sola (`updateAge`), no hay token rotativo |
| GET | `/users/me` | *me* (nuestro, no de Better Auth) |

La sesión viaja en cookie httpOnly (web) o en `Authorization: Bearer <token>`
(móvil / servicio a servicio, cabecera `set-auth-token` del login). Toda
petición que muta estado y llega con cookie de sesión exige `Origin`
(`verificarOrigen`, defensa CSRF); un cliente Bearer puro no la necesita.
Detalle de integración desde React (cliente, CORS, CSRF): `docs/frontend.md`.

Ejemplo real de login (`director@hospital.test`, contraseña la de
`SEED_TEST_PASSWORD`):

```bash
curl -c cookies.txt -X POST http://localhost:3100/api/v1/auth/sign-in/email \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:5173' \
  -d '{"email":"director@hospital.test","password":"..."}'
```
```json
{"redirect":false,"token":"tQmGWf8Jhr1NHZU4YXe7TGW4jNH3VfoO",
 "user":{"name":"Director de prueba","email":"director@hospital.test","emailVerified":true,
 "image":null,"twoFactorEnabled":false,"status":"ACTIVE","deletedAt":null,
 "id":"777e51a8-f549-40c2-ae3a-fb2d767a40a7"}}
```

---

## Contrato de respuesta

Una única forma, en `core/http/api-response.ts`. Nunca `res.json({...})` libre.

**Éxito** (`ok`/`created`):
```json
{ "success": true, "data": { "...": "..." }, "meta": { "requestId": "...", "timestamp": "..." } }
```

**Éxito paginado** (`paginated`, cursor o página):
```json
{
  "success": true,
  "data": [ { "...": "..." } ],
  "pagination": { "limit": 20, "hasNext": true, "nextCursor": "uuid-o-null" },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

**Error** (lo emite solo el error handler, nunca un controlador):
```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [ { "field": "email", "message": "..." } ] },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

El cliente hace `switch` sobre `error.code`, nunca sobre `error.message` (texto
humano, puede cambiar). `204 No Content` (`noContent`) no lleva cuerpo.

---

## Códigos de error (`ErrorCode`, `core/http/http-status.ts`)

| Código | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 400 / 422 | Zod rechaza `body`/`query`/`params`; 400 solo si el JSON es ilegible |
| `UNAUTHORIZED` / `TOKEN_INVALID` | 401 | sin sesión, sesión inválida o caducada |
| `FORBIDDEN` / `INSUFFICIENT_PERMISSIONS` | 403 | `requirePermissions`/`requireRoles`/guardas de no-escalada |
| `ACCOUNT_SUSPENDED` | 403 | cuenta con `status = SUSPENDED` |
| `EMAIL_NOT_VERIFIED` | 403 | `requireVerifiedEmail` con `REQUIRE_VERIFIED_EMAIL=true` |
| `NOT_FOUND` | 404 | recurso inexistente o fuera del ámbito del actor (mismo código: anti-enumeración) |
| `CONFLICT` | 409 | transición de estado inválida (p. ej. alerta `RESOLVED → ACKNOWLEDGED`) |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | body presente sin `Content-Type: application/json` |
| `QUERY_REJECTED` | 422 | el DSL del asistente no pasa la validación semántica contra el catálogo |
| `RATE_LIMITED` | 429 | techo de `globalRateLimit`/`authRateLimit`/`assistantRateLimit`/`internalRateLimit` |
| `INTERNAL_ERROR` | 500 | no filtra el mensaje interno en producción |
| `AGENT_ERROR` | 502 | Python respondió, pero con HTTP no-2xx o un cuerpo que no pasa Zod |
| `AGENT_UNAVAILABLE` | 503 | sin `AGENT_URL`, timeout o error de red hacia Python |
| `EXTERNAL_SERVICE_ERROR` | 502/503/504 | genérico para dependencias externas (incluye "no hay datos HIS importados") |

Ejemplos reales:

```json
// GET /users/me sin cookie de sesión
{"success":false,"error":{"code":"TOKEN_INVALID","message":"La sesion no es valida."},
 "meta":{"requestId":"fdd4a993-...","timestamp":"2026-09-24T01:06:11.546Z"}}

// PUT /medications/.../stock como DIRECTOR (no tiene medications:manage)
{"success":false,"error":{"code":"INSUFFICIENT_PERMISSIONS",
 "message":"Permisos insuficientes. Requiere todos de: medications:manage."},
 "meta":{"requestId":"6d4aad5e-...","timestamp":"2026-09-24T01:06:11.566Z"}}

// GET /dashboard/summary?campoRaro=1
{"success":false,"error":{"code":"VALIDATION_ERROR","message":"Los datos enviados no son validos.",
 "details":[{"field":"query","message":"Unrecognized key(s) in object: 'campoRaro'","code":"unrecognized_keys"}]},
 "meta":{"requestId":"f2270090-...","timestamp":"2026-09-24T01:06:11.585Z"}}

// PATCH /users/me con Content-Type: text/plain
{"success":false,"error":{"code":"UNSUPPORTED_MEDIA_TYPE","message":"El cuerpo debe enviarse como application/json."},
 "meta":{"requestId":"4d3b12ef-...","timestamp":"2026-09-24T01:06:11.601Z"}}
```

---

## Endpoints propios

Todos requieren `authenticate` salvo `/health/**`. Orden de middlewares fijo:
`authenticate → validate → requirePermissions → controller` (CLAUDE.md §5).

### `users`

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/users/me` | sesión válida |
| PATCH | `/users/me` | sesión válida (`updateMeSchema`, sin `status`: no es mass assignment) |
| GET | `/users` | `users:read` |
| POST | `/users` | `users:create` |
| GET | `/users/{id}` | `users:read` o ser el dueño |
| PATCH | `/users/{id}` | `users:update` |
| DELETE | `/users/{id}` | `users:delete` (borrado lógico) |
| PUT | `/users/{id}/roles` | `users:assign-roles` (+ doble guarda de no-escalada) |

`GET /users/me` (real, `director@hospital.test`):
```json
{"success":true,"data":{"id":"777e51a8-f549-40c2-ae3a-fb2d767a40a7","email":"director@hospital.test",
 "name":"Director de prueba","image":null,"status":"ACTIVE","emailVerified":true,"twoFactorEnabled":false,
 "roles":["DIRECTOR"],
 "permissions":["alerts:read","analytics:export","analytics:read","assistant:advanced","assistant:use",
 "dashboard:read","medications:read","services:read","surgeries:read"],
 "createdAt":"2026-09-23T20:47:11.137Z"},"meta":{"requestId":"...","timestamp":"..."}}
```

`POST /users` con `roles: []`: Better Auth asigna el rol por defecto
(`DEFAULT_ROLE = CONSULTA`) en su hook de registro, así que la respuesta
trae ese rol aunque no se haya pedido explícitamente:
```json
{"success":true,"data":{"id":"dd125c83-...","email":"demo.temp@hospital.test","name":"Usuario temporal docs",
 "image":null,"status":"ACTIVE","emailVerified":false,"twoFactorEnabled":false,
 "roles":["CONSULTA"],"permissions":["dashboard:read"],"createdAt":"2026-09-24T01:10:02.518Z"},
 "meta":{"requestId":"...","timestamp":"..."}}
```

`PUT /users/{id}/roles` (admin reemplaza los roles de otro usuario por `["ANALISTA"]`):
```json
{"success":true,"data":{"id":"dd125c83-...","status":"SUSPENDED","roles":["ANALISTA"],
 "permissions":["analytics:read","assistant:use","dashboard:read","medications:read","services:read","surgeries:read"],
 "...":"..."},"meta":{"requestId":"...","timestamp":"..."}}
```
`DELETE /users/{id}` → `204` sin cuerpo (borrado lógico: `deletedAt` + `status: DELETED`).

### `roles`

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/roles` | `roles:read` |
| POST | `/roles` | `roles:create` (el comodín `*` no se puede asignar por API) |
| GET | `/roles/{id}` | `roles:read` |
| PATCH | `/roles/{id}` | `roles:update` (roles de sistema, inmutables) |
| DELETE | `/roles/{id}` | `roles:delete` |
| PUT | `/roles/{id}/permissions` | `roles:assign-permissions` |

`GET /roles?limit=3` (real, hay 7 en total: los `SYSTEM_ROLES`):
```json
{"success":true,"data":[
  {"id":"8325b61f-...","name":"ADMIN","description":"Administra usuarios, roles y la configuracion del hospital.",
   "isSystem":true,"permissions":["alerts:manage","alerts:read","analytics:export","...(25 en total)"],"usersCount":0,"createdAt":"..."},
  {"id":"ee80f9bd-...","name":"ANALISTA","isSystem":true,
   "permissions":["analytics:read","assistant:use","dashboard:read","medications:read","services:read","surgeries:read"],"usersCount":0,"createdAt":"..."},
  {"id":"da871151-...","name":"CONSULTA","isSystem":true,"permissions":["dashboard:read"],"usersCount":0,"createdAt":"..."}],
 "pagination":{"limit":3,"hasNext":true,"nextCursor":null,"total":7,"page":1,"totalPages":3,"hasPrev":false},
 "meta":{"requestId":"...","timestamp":"..."}}
```
`POST /roles` (real, rol de cliente, no de sistema):
```json
{"success":true,"data":{"id":"00db2903-...","name":"demo_temp_role","description":"temporal para docs",
 "isSystem":false,"permissions":["dashboard:read"],"usersCount":0,"createdAt":"2026-09-24T01:09:54.553Z"},
 "meta":{"requestId":"...","timestamp":"..."}}
```
`PUT /roles/{id}/permissions` reemplaza el set completo (respuesta con `permissions` ya actualizado).
`DELETE /roles/{id}` de un rol vacío (sin usuarios) → `204`.

### `permissions` y `audit`

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/permissions` | `permissions:read` (catálogo agrupado, solo lectura) |
| GET | `/audit` | `audit:read` (append-only, sin escritura por API) |

`GET /permissions` (real, 25 permisos en 10 grupos):
```json
{"success":true,"data":{"total":25,"groups":[
  {"group":"alerts","permissions":[
    {"id":"725e9cd5-...","action":"alerts:manage","group":"alerts","description":"Reconocer y resolver alertas"},
    {"id":"a6e20f1b-...","action":"alerts:read","group":"alerts","description":"Ver alertas operativas"}]},
  {"group":"analytics","permissions":[
    {"id":"29cf06e3-...","action":"analytics:export","group":"analytics","description":"Exportar datos de analitica"},
    {"id":"782203dc-...","action":"analytics:read","group":"analytics","description":"Ver analitica e indicadores"}]}
  ]},"meta":{"requestId":"...","timestamp":"..."}}
```
`GET /audit?limit=2` (real, cursor por `lastSeenAt`/`id`):
```json
{"success":true,"data":[
  {"id":"c44457b4-...","action":"assistant.query","actorId":"777e51a8-...","actorEmail":"director@hospital.test",
   "targetType":"assistant","targetId":null,
   "metadata":{"nRows":5,"status":"ok","datasets":["alerts","admissions","services","medications","surgeries"],
   "nQueries":1,"question":"¿Cuál es la espera por nivel de triage?"},
   "ip":"::1","requestId":"1cb6dae9-...","createdAt":"2026-09-24T01:06:02.655Z"},
  {"id":"25493c02-...","action":"agent.internal.query","actorId":"777e51a8-...","actorEmail":"director@hospital.test",
   "targetType":"assistant","metadata":{"dataset":"admissions","rowCount":5,"requestId":"1cb6dae9-..."},
   "ip":null,"requestId":null,"createdAt":"2026-09-24T01:06:02.646Z"}],
 "pagination":{"limit":2,"hasNext":true,"nextCursor":"25493c02-..."},"meta":{"requestId":"...","timestamp":"..."}}
```

### `alerts`

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/alerts` | `alerts:read` (+ filtrado por ámbito, ver `docs/rbac.md`) |
| GET | `/alerts/{id}` | `alerts:read` (fuera de ámbito → 404, igual que id inexistente) |
| PATCH | `/alerts/{id}` | `alerts:manage` (`{ status: 'ACKNOWLEDGED' \| 'RESOLVED' }`) |
| POST | `/alerts/evaluate` | `alerts:manage` (sin body; dispara a mano la misma evaluación que el job periódico) |

El motor de reglas se evalúa solo al arrancar el servidor y cada
`ALERT_EVAL_INTERVAL_MINUTES` (`alerts.job.ts`), a partir de las métricas
reales de ocupación, espera, demanda, inventario y cirugía
(`alerts.metrics.ts`, que reusa los servicios de `dashboard`/`analytics`/
`medications`/`surgeries`, nunca toca Prisma directo). `POST /alerts/evaluate`
dispara la misma pasada sin esperar el calendario, y queda auditada como
`alert.evaluated`. Real, tras registrar poco stock de un medicamento de alto
consumo (`PUT /medications/N02BA001400/stock {"quantity":10}`):
```json
// POST /alerts/evaluate
{"success":true,"data":{"creadas":1,"actualizadas":6,"resueltas":0,"evaluadoEn":"2026-09-24T01:15:23.001Z"},
 "meta":{"requestId":"...","timestamp":"..."}}

// GET /alerts?type=LOW_STOCK (FARMACIA)
{"success":true,"data":[{"id":"6db6b455-...","type":"LOW_STOCK","severity":"CRITICAL","status":"OPEN",
  "scope":"medication","scopeId":"N02BA001400","metric":"medication.daysOfInventory","value":0,"threshold":3,
  "message":"Dias de inventario de ACETAMINOFEN 500 mg TABLETA: 0.0 por debajo del umbral de 3.",
  "firstSeenAt":"2026-09-24T01:15:22.998Z","lastSeenAt":"2026-09-24T01:15:22.998Z",
  "acknowledgedAt":null,"resolvedAt":null}],
 "pagination":{"limit":20,"hasNext":false,"nextCursor":null},"meta":{"requestId":"...","timestamp":"..."}}
```
Con solo los datos del HIS importados (sin ningún stock registrado), el job
ya crea alertas de `HIGH_OCCUPANCY`, `DEMAND_SPIKE` y `SURGERY_CANCELLATIONS`
al arrancar: el panel de alertas no empieza vacío. Ver el flujo completo de
demo en `docs/frontend.md` §8.

### `assistant`

| Método | Ruta | Permiso |
|---|---|---|
| POST | `/assistant/query` | `assistant:use` (`{ question: string }`, 3–500 car.) |

Real, con `npm run agent:mock` corriendo y pregunta "¿Cuál es la espera por
nivel de triage?" (DIRECTOR, `assistant:advanced`):
```json
{"success":true,"data":{"status":"ok",
 "answer":"Segun \"admissions\" (5 fila(s), truncado=false): triage_level=1, avg_wait_minutes=26.72... | triage_level=2, avg_wait_minutes=47.84...",
 "queries":[{"query":{"dataset":"admissions","metrics":[{"agg":"avg","field":"wait_minutes"}],
   "groupBy":[{"field":"triage_level"}],"filters":[],"orderBy":[],"limit":10},
   "columns":["triage_level","avg_wait_minutes"],
   "rows":[{"triage_level":1,"avg_wait_minutes":26.726937547027838},{"triage_level":2,"avg_wait_minutes":47.842350427350446}],
   "rowCount":5,"truncated":false}]},"meta":{"requestId":"...","timestamp":"..."}}
```

La API interna del agente (`POST /internal/agent/query`) vive en el segundo
puerto y **no** aparece aquí ni en `openapi.json`: contrato completo en
`docs/agent-integration.md`.

### `dashboard`

Todos aceptan `desde`/`hasta` (ISO 8601, opcionales; por defecto 30 días
hasta la fecha de referencia de los datos HIS: `max(admittedAt)`, no `now()`).

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/dashboard/summary` | `dashboard:read` |
| GET | `/dashboard/occupancy` | `dashboard:read` + `services:read` |
| GET | `/dashboard/wait-times` | `dashboard:read` + `services:read` |
| GET | `/dashboard/demand` | `dashboard:read` + `services:read` |

`GET /dashboard/summary` (real):
```json
{"success":true,"data":{
  "periodo":{"desde":"2026-08-22T19:33:44.000Z","hasta":"2026-09-21T19:33:44.000Z"},
  "datosHasta":"2026-09-21T19:33:44.000Z",
  "admissions":{"last24h":119,"last7d":865,"periodo":3681},
  "occupancy":{"census":358,"physicalBeds":365,"occupancyPct":98.08219178082192,
    "metodo":"censo_estimado_ultima_actividad"},
  "waitTimeP50Minutes":51.18333333333333,
  "alerts":{"WARNING":0,"CRITICAL":0}},
 "meta":{"requestId":"...","timestamp":"..."}}
```
`alerts` solo aparece si el actor tiene algún ámbito visible
(`medications:read`/`services:read`/`surgeries:read`).

`GET /dashboard/occupancy` (real, nótese `HOSPITALIZACION` y `PEDIATRIA` por
encima del 100 %: son camas virtuales, ver `docs/database.md` y
`docs/frontend.md` §7):
```json
{"success":true,"data":{
  "periodo":{"desde":"2026-08-22T19:33:44.000Z","hasta":"2026-09-21T19:33:44.000Z"},
  "datosHasta":"2026-09-21T19:33:44.000Z","metodo":"censo_estimado_ultima_actividad",
  "porUnidad":[
    {"unit":"HOSPITALIZACION","physicalBeds":129,"census":147,"virtualCensus":38,"occupancyPct":113.95348837209302},
    {"unit":"PEDIATRIA","physicalBeds":38,"census":46,"virtualCensus":18,"occupancyPct":121.05263157894737},
    {"unit":"URGENCIAS","physicalBeds":65,"census":60,"virtualCensus":45,"occupancyPct":92.3076923076923}],
  "serieDiaria":[
    {"day":"2026-09-20","census":451,"occupancyPct":123.56164383561644},
    {"day":"2026-09-21","census":93,"occupancyPct":25.47945205479452}]},
 "meta":{"requestId":"...","timestamp":"..."}}
```

`GET /dashboard/wait-times` (real):
```json
{"success":true,"data":{
  "periodo":{"desde":"2026-08-22T19:33:44.000Z","hasta":"2026-09-21T19:33:44.000Z"},
  "porNivel":[
    {"level":1,"n":97,"p50":24.7,"p90":44.91,"avg":28.123367697594510},
    {"level":2,"n":358,"p50":44.1,"p90":77.76833333333335,"avg":48.78230912476718},
    {"level":3,"n":2422,"p50":54.99166666666667,"p90":102.24,"avg":61.53852188274153}],
  "serieDiaria":[{"day":"2026-09-20","n":88,"p50":45.75},{"day":"2026-09-21","n":72,"p50":62.7}]},
 "meta":{"requestId":"...","timestamp":"..."}}
```

`GET /dashboard/demand` (real, recortado):
```json
{"success":true,"data":{
  "periodo":{"desde":"2026-08-22T19:33:44.000Z","hasta":"2026-09-21T19:33:44.000Z"},
  "datosHasta":"2026-09-21T19:33:44.000Z",
  "porDiaYUnidad":[{"day":"2026-09-21","unit":"URGENCIAS","n":68},{"day":"2026-09-21","unit":"PEDIATRIA","n":2}],
  "porViaIngreso":[{"entryRoute":"Urgencias","n":3584},{"entryRoute":"Cirugia Ambulatorias","n":62},{"entryRoute":"Remitido","n":35}],
  "perfilHorario":[{"hour":0,"n":61},{"hour":11,"n":261},{"hour":23,"n":107}],
  "cambioPorUnidad":[
    {"unit":"URGENCIAS","last7":441,"prev7":381,"changePct":15.748031496062993},
    {"unit":"UNIDAD DE CUIDADO INTENSIVO","last7":24,"prev7":4,"changePct":500}]},
 "meta":{"requestId":"...","timestamp":"..."}}
```

### `analytics`

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/analytics/services` | `analytics:read` + `services:read` |
| GET | `/analytics/triage` | `analytics:read` + `services:read` |
| GET | `/analytics/services/export` | `analytics:export` + `analytics:read` + `services:read` (CSV) |
| GET | `/analytics/triage/export` | `analytics:export` + `analytics:read` + `services:read` (CSV) |

`GET /analytics/services` (real, recortado):
```json
{"success":true,"data":{
  "periodo":{"desde":"2026-08-22T19:33:44.000Z","hasta":"2026-09-21T19:33:44.000Z"},
  "porAreaEspecialidad":[
    {"area":"APOYO DIAGNOSTICO - LABORATORIO CLINICO","specialty":"MEDICINA GENERAL","lines":44224,"quantity":44225},
    {"area":"APOYO TERAPEUTICO - TERAPIA RESPIRATORIA","specialty":"TERAPIA RESPIRATORIA","lines":32516,"quantity":35468}],
  "topProcedimientos":["...top 10 con code/name/count..."],
  "serieDiaria":["...un punto por día..."]},
 "meta":{"requestId":"...","timestamp":"..."}}
```

`GET /analytics/triage` (real, recortado):
```json
{"success":true,"data":{
  "periodo":{"desde":"2026-08-22T19:33:44.000Z","hasta":"2026-09-21T19:33:44.000Z"},
  "porNivel":[{"level":1,"n":97},{"level":2,"n":358},{"level":3,"n":2422},{"level":4,"n":512}],
  "porClasificacion":[
    {"classification":"CONSULTORIOS DIFERIDA - TRIAGE 3","n":897},
    {"classification":"GINECOLOGIA DIFERIDA - TRIAGE 3","n":408}],
  "perfilHorario":["...0-23h..."],
  "esperaPorNivel":["...igual forma que dashboard/wait-times.porNivel..."]},
 "meta":{"requestId":"...","timestamp":"..."}}
```

`GET /analytics/services/export` y `/analytics/triage/export` devuelven CSV
(`Content-Type: text/csv`, adjunto), no el contrato JSON — ver
`docs/frontend.md` §9.

### `medications`

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/medications` | `medications:read` (paginado por página; `search`, `kind`) |
| GET | `/medications/critical` | `medications:read` |
| GET | `/medications/consumption` | `medications:read` |
| PUT | `/medications/{code}/stock` | `medications:manage` |

`GET /medications?limit=2` (real; sin stock registrado todo es
`'insufficient_data'`, B0: el HIS no trae stock):
```json
{"success":true,"data":[
  {"code":"J05AF06","name":"ABACAVIR 20MG/ML SOLUCION ORAL FRASCO 240ML","kind":"medicamento",
   "quantity":0,"lines":0,"lastDispensedAt":"2026-08-20T22:35:26.000Z","stock":null,
   "avgDailyConsumption":"insufficient_data","daysOfInventory":"insufficient_data",
   "risk":"insufficient_data","rotation":"insufficient_data"}],
 "pagination":{"limit":2,"hasNext":true,"nextCursor":null,"total":1327,"page":1,"totalPages":664,"hasPrev":false},
 "meta":{"requestId":"...","timestamp":"..."}}
```
`GET /medications/critical` sin ningún stock registrado (real):
```json
{"success":true,"data":{"status":"insufficient_data","reason":"No hay stock registrado para ningun medicamento.","items":[]},
 "meta":{"requestId":"...","timestamp":"..."}}
```
`PUT /medications/{code}/stock` (real, FARMACIA):
```bash
curl -b cookies-farmacia.txt -H 'Content-Type: application/json' -H 'Origin: http://localhost:5173' \
  -X PUT http://localhost:3100/api/v1/medications/J05AF06/stock -d '{"quantity": 1}'
```
```json
{"success":true,"data":{"code":"J05AF06","quantity":1,"updatedAt":"2026-09-24T01:05:38.682Z"},
 "meta":{"requestId":"...","timestamp":"..."}}
```
Con ese `code` es ahora `stock: 1` y `risk`/`daysOfInventory` dejan de ser
`'insufficient_data'` la próxima vez que se consulte `/medications`.

`GET /medications/consumption` (real, recortado):
```json
{"success":true,"data":{"desde":"2026-08-22T19:33:44.000Z","hasta":"2026-09-21T19:33:44.000Z","grain":"day","code":null,
 "series":[{"date":"2026-08-22T00:00:00.000Z","quantity":1978},{"date":"2026-08-23T00:00:00.000Z","quantity":6878}],
 "top":["...top 10 code/name/quantity..."],"byArea":["...cantidad por area..."]},
 "meta":{"requestId":"...","timestamp":"..."}}
```

### `surgeries`

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/analytics/surgeries` | `analytics:read` + `surgeries:read` (sin periodo: el HIS no trae fecha) |
| GET | `/analytics/surgeries/export` | `analytics:export` + `analytics:read` + `surgeries:read` (CSV) |

`GET /analytics/surgeries` (real, recortado):
```json
{"success":true,"data":{
  "totalSchedules":12770,"distinctProcedures":956,
  "withAdmissionInExtract":{"count":3264,"pct":25.56},
  "verifiable":{"total":3264,"executed":2216,"executedPct":67.89,"notExecuted":1048,"notExecutedPct":32.11},
  "unknown":9506,
  "topProcedures":[
    {"code":"053114","name":"BLOQUEO SIMPÁTICO REGIONAL (CERVICAL- TORÁCICO O LUMBAR)","count":440},
    {"code":"053105","name":"BLOQUEO DE UNIÓN MIONEURAL","count":426}],
  "byUnit":["...conteo por unidad del ingreso vinculado..."]},
 "meta":{"requestId":"...","timestamp":"..."}}
```
`executedPct`/`notExecutedPct` son porcentajes **solo sobre `verifiable`**
(las programaciones con ingreso en el extracto), no sobre `totalSchedules`.

### `health` (público, sin `authenticate`)

| Método | Ruta | Qué comprueba |
|---|---|---|
| GET | `/health` | liveness: nada, solo que el proceso responde |
| GET | `/health/ready` | BD, Redis, saturación del hashing, agente (`status: 'ready' \| 'degraded'`) |
| GET | `/health/startup` | igual que `/ready` para el criterio de arranque |

`GET /health/ready` (real, con Redis no configurado en dev y el agente simulado corriendo):
```json
{"success":true,"data":{"status":"ready","checks":{"database":"up","redis":"no configurado","passwordHashing":"0/4","agent":"up"}},
 "meta":{"requestId":"...","timestamp":"..."}}
```