# Guía para el frontend (React)

Esta guía es para quien integra el panel de React esta semana. Cubre arranque
local, autenticación, el contrato de la API, qué ve cada usuario de prueba y,
pantalla a pantalla, qué endpoint pinta cada una. El contrato ejecutable
siempre es `GET /api/v1/openapi.json`; si algo aquí difiere, el JSON manda
(ver `docs/api.md`).

---

## 1. Arranque en local: 3 procesos

| # | Proceso | Puerto | Comando |
|---|---|---|---|
| 1 | API pública + API interna del agente | `3000` + `3001` | `npm run dev` |
| 2 | Agente IA simulado (Python de mentira) | `8000` | `npm run agent:mock` |
| 3 | Frontend React | `5173` | el que use el proyecto de React (`npm run dev` de Vite, típicamente) |

Antes de arrancar nada:

```bash
cp .env.example .env
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 48)" >> .env
# Genera dos claves DISTINTAS para el canal del agente (>=32 caracteres cada una):
echo "AGENT_API_KEY=$(openssl rand -hex 32)" >> .env
echo "INTERNAL_API_KEY=$(openssl rand -hex 32)" >> .env
echo "AGENT_URL=http://127.0.0.1:8000" >> .env

docker compose up -d postgres redis   # o Postgres/Redis locales; Redis es opcional en dev
npm install
npm run db:migrate                    # crea/aplica las migraciones sobre DATABASE_URL
npm run db:seed:dev                   # permisos, roles de sistema, superadmin y usuarios de prueba
```

Con las migraciones aplicadas, importa los datos reales del HIS (una vez;
`npm run data:import` es idempotente, así que relanzarlo no duplica nada).
Coloca los 7 `.txt` del extracto en `data/raw/` (carpeta ignorada por git) y
corre:

```bash
npm run data:import                 # lee data/raw/*.txt (o --dir otra-carpeta)
```

Verás en consola un resumen por archivo (procesadas/insertadas/duplicadas/
saltadas/inválidas) y un detalle en `data/import-report.json`. Sin estos
datos, cualquier pantalla que dependa del HIS (dashboard, ocupación,
medicamentos, cirugías, asistente) responde `503 EXTERNAL_SERVICE_ERROR`
("No hay datos HIS importados"): es el primer síntoma si el panel no carga
nada.

Ahora los 3 procesos, cada uno en su terminal:

```bash
# Terminal 1 — API (pública :3000, interna del agente :3001)
npm run dev

# Terminal 2 — agente simulado (solo desarrollo, sin dependencias)
npm run agent:mock

# Terminal 3 — React
npm run dev    # en el repo del frontend, normalmente contra http://localhost:5173
```

El agente simulado (`scripts/agent-mock.mjs`) no es un LLM: elige una
consulta del DSL por palabras clave de la pregunta ("medicamento", "espera"/
"triage", "cirugía", o `admissions` por defecto) y se la propone al puerto
interno de Node, que es quien de verdad valida y ejecuta. Sirve para probar
el flujo de punta a punta sin tener el agente Python real corriendo. Lee
`docs/agent-integration.md` si el equipo de Python necesita el contrato.

Si algo no arranca, revisa en este orden: `.env` existe y `BETTER_AUTH_SECRET`
tiene 32+ caracteres; `DATABASE_URL` apunta a una base migrada; si usas el
asistente, `AGENT_URL`/`AGENT_API_KEY`/`INTERNAL_API_KEY` están las tres o
`POST /assistant/query` responde `503 AGENT_UNAVAILABLE` (no rompe el resto
de la API: es una dependencia opcional).

---

## 2. Autenticación: Better Auth desde React

No hay `POST /api/v1/auth/login`: la ruta es `POST /api/v1/auth/sign-in/email`,
la sirve **Better Auth** (no un módulo propio), y el basePath es
`/api/v1/auth` (`API_PREFIX` + `/auth`). Usa el cliente oficial en vez de
llamar a `fetch` a mano: te da los hooks de sesión reactivos.

```bash
npm install better-auth
```

```ts
// src/lib/auth-client.ts
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: 'http://localhost:3000',   // API_URL del backend, sin el prefijo
  basePath: '/api/v1/auth',           // API_PREFIX + '/auth'
  fetchOptions: {
    credentials: 'include',           // IMPRESCINDIBLE: envía y recibe la cookie httpOnly de sesión
  },
});

export const { signIn, signOut, useSession } = authClient;
```

Login y sesión reactiva:

```tsx
// login
await authClient.signIn.email({ email, password });
// callbackURL/redirectTo, si los usas, deben estar en CORS_ORIGINS (ver §3):
// un valor fuera de esa lista es un open redirect y Better Auth lo rechaza.

// en cualquier componente
const { data: session, isPending } = authClient.useSession();
// session?.user trae el perfil de Better Auth (id, email, name, emailVerified...),
// pero NO roles ni permisos: para eso, GET /api/v1/users/me (ver §4).

// logout
await authClient.signOut();
```

Segundo factor (TOTP): si una cuenta lo tiene activado, `signIn.email` puede
devolver que falta el segundo paso; el siguiente endpoint es
`POST /api/v1/auth/two-factor/verify-totp`. Ninguno de los usuarios de prueba
lo tiene activado por defecto.

Para el resto de la API (todo lo que **no** es `/auth/**`), usa tu cliente
HTTP normal (`fetch`, `axios`...) con la misma condición: **cookies
incluidas**.

```ts
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`http://localhost:3000/api/v1${path}`, {
    ...init,
    credentials: 'include',   // sin esto, la cookie de sesión no viaja y todo da 401
    headers: {
      'Content-Type': 'application/json',
      // Origin lo pone el navegador solo en peticiones cross-origin; no lo fuerces a mano
      // salvo que pruebes con curl/Postman (ver §3).
      ...init.headers,
    },
  });
  const body = await res.json();
  if (!res.ok) throw body.error; // { code, message, details? } — ver la tabla del §5
  return body.data;
}
```

---

## 3. Por qué hace falta `Origin` (CSRF) y `CORS_ORIGINS`

Con la sesión en cookie httpOnly, cualquier ruta que cambie estado es un
objetivo CSRF. `verificarOrigen` (montado en `app.ts` para toda la API,
después del rate limit global) lo cierra así:

- Si la petición **no** trae la cookie de sesión (p. ej. un cliente con
  `Authorization: Bearer`), no exige `Origin`: no hay vector CSRF posible.
- Si **sí** trae cookie de sesión y es `POST`/`PUT`/`PATCH`/`DELETE`, exige un
  `Origin` (o `Referer`) cuyo origen esté en `CORS_ORIGINS`. Sin él, o con uno
  fuera de la lista → `403 FORBIDDEN`.

Desde el navegador esto es automático: el propio navegador añade `Origin` en
toda petición cross-origin, así que mientras React corra en una URL que esté
en `CORS_ORIGINS` (`http://localhost:5173` por defecto en `.env.example`) no
hay que hacer nada especial. Esto solo se nota "a mano" si pruebas con `curl`
o Postman: hay que añadir `-H 'Origin: http://localhost:5173'` en cada
mutación, o te encontrarás un 403 que no aparece nunca desde el navegador.

`CORS_ORIGINS` es una lista (separada por coma) que cumple **dos** papeles a
la vez: el `origin` de CORS (qué dominios pueden leer la respuesta) y los
`trustedOrigins` de Better Auth (contra qué se valida `Origin` y todo
`callbackURL`/`redirectTo`). Si despliegas el frontend en otra URL, añádela
ahí — un valor de más es un open redirect, así que no pongas comodines.

---

## 4. Contrato de respuesta, paginación y errores

Toda respuesta tiene la misma forma (`core/http/api-response.ts`):

```json
// éxito
{ "success": true, "data": { "...": "..." }, "meta": { "requestId": "...", "timestamp": "..." } }

// éxito paginado (listados)
{ "success": true, "data": [ { "...": "..." } ],
  "pagination": { "limit": 20, "hasNext": true, "nextCursor": "uuid-o-null" },
  "meta": { "requestId": "...", "timestamp": "..." } }

// error (nunca lo construye un controlador a mano)
{ "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [{ "field": "email", "message": "..." }] },
  "meta": { "requestId": "...", "timestamp": "..." } }
```

**Regla de oro: el switch de la UI es sobre `error.code`, nunca sobre
`error.message`** (es texto humano en español, puede cambiar sin aviso).

La paginación tiene dos modos, según el endpoint:
- **Cursor** (`alerts`, `audit`): pide la primera página sin `cursor`; si
  `pagination.hasNext` es `true`, repite con `?cursor=<pagination.nextCursor>`.
  No hay "ir a la página 5": es scroll infinito o "cargar más".
- **Página** (`users`, `roles`, `medications`): trae además `total`, `page`,
  `totalPages`, `hasPrev` — sirve para un paginador con números.

### Tabla de códigos de error: qué hacer en la UI

| `error.code` | HTTP | Qué hacer en el frontend |
|---|---|---|
| `VALIDATION_ERROR` | 400/422 | Pintar `error.details` bajo cada campo (`field`/`message`). 400 solo si el JSON estaba mal formado (raro, es un bug del cliente) |
| `UNAUTHORIZED` / `TOKEN_INVALID` | 401 | No hay sesión o caducó: redirigir a login. Ver §10 |
| `FORBIDDEN` / `INSUFFICIENT_PERMISSIONS` | 403 | El usuario no tiene el permiso: ocultar o deshabilitar la acción de antemano (con `permissions` de `GET /users/me`) en vez de dejar que falle |
| `ACCOUNT_SUSPENDED` | 403 | Mensaje "tu cuenta está suspendida", cerrar sesión |
| `EMAIL_NOT_VERIFIED` | 403 | Pedir verificar el correo |
| `NOT_FOUND` | 404 | Recurso inexistente **o** fuera del ámbito del actor (mismo código a propósito: anti-enumeración). Tratar igual en la UI: "no encontrado" |
| `CONFLICT` | 409 | Transición de estado inválida (p. ej. reabrir una alerta ya `RESOLVED`). Refrescar el recurso y mostrar su estado actual |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Bug del cliente: falta `Content-Type: application/json` en un body |
| `QUERY_REJECTED` | 422 | Solo lo ve el asistente si el DSL es inválido; en la práctica, mostrar "no pude interpretar esa pregunta" |
| `RATE_LIMITED` | 429 | Backoff y reintento; ver §10 |
| `AGENT_UNAVAILABLE` | 503 | El asistente está caído: deshabilitar el chat con un aviso, el resto del panel sigue funcionando |
| `AGENT_ERROR` | 502 | El agente respondió mal: "no pude responder, intenta reformular" |
| `INTERNAL_ERROR` / `EXTERNAL_SERVICE_ERROR` | 500/502/503/504 | Pantalla de error genérica; nunca se filtra el mensaje interno en producción |

Ejemplo real (`GET /dashboard/summary?campoRaro=1`):

```json
{"success":false,"error":{"code":"VALIDATION_ERROR","message":"Los datos enviados no son validos.",
"details":[{"field":"query","message":"Unrecognized key(s) in object: 'campoRaro'","code":"unrecognized_keys"}]},
"meta":{"requestId":"f2270090-...","timestamp":"2026-09-24T01:06:11.585Z"}}
```

---

## 5. Usuarios de prueba: qué ve y qué no ve cada uno

Sembrados por `npm run db:seed:dev` (contraseña: la de `SEED_TEST_PASSWORD`
en `.env` — **nunca la escribas en código ni en commits**, usa el nombre de
la variable).

| Usuario | Rol | Correo (por defecto) | Ve |
|---|---|---|---|
| Superadmin | `SUPER_ADMIN` | el de `SEED_ADMIN_EMAIL` | Todo (permiso `*`): administración completa, todas las pantallas de datos |
| Director de prueba | `DIRECTOR` | `director@hospital.test` | Dashboard, analítica (+ exportar CSV), asistente **avanzado** (más cupo de preguntas), alertas (todos los ámbitos: medicación, servicio, triage, cirugía — solo lectura), medicamentos (solo lectura), cirugías. **No** administra usuarios/roles ni gestiona stock/alertas |
| Farmacia de prueba | `FARMACIA` | `farmacia@hospital.test` | Medicamentos (lectura **y** gestión de stock), alertas — pero **solo** las de ámbito `medication` (`GET /alerts` de otro ámbito ni aparece en la lista; `GET /alerts/:id` de una de servicio da `404`, igual que un id inexistente), asistente básico. **No** ve dashboard, analítica ni cirugías (sin `dashboard:read`/`analytics:read`/`surgeries:read`) |

Matriz completa de roles y permisos en `docs/rbac.md`. Puntos que sorprenden
en el frontend:

- El filtrado de alertas por ámbito **no es un permiso que falta**: es
  filtrado por fila. `FARMACIA` tiene `alerts:read` (pasa el middleware),
  pero el listado igual solo trae `medication`. No lo trates como un 403.
- Un usuario sin ningún ámbito visible (ninguno de
  `medications:read`/`services:read`/`surgeries:read`) simplemente no recibe
  el bloque `alerts` en `GET /dashboard/summary` — compruébalo con
  `'alerts' in data`, no asumas que siempre está.
- **Resend en modo sandbox**: sin un dominio propio verificado, la cuenta de
  Resend solo entrega correos a **su propia dirección**. Así que, salvo que
  se configure `SEED_DIRECTOR_EMAIL`/`SEED_FARMACIA_EMAIL` con esa dirección,
  ninguno de los dos usuarios de prueba recibirá correos reales (verificación,
  alertas por email si se añadieran). Para la demo, esto no bloquea nada: las
  cuentas de prueba nacen ya verificadas por el seed.

---

## 6. Pantalla a pantalla

Todas exigen sesión (`authenticate`); los permisos son los de
`requirePermissions` en la ruta (`docs/api.md` tiene la lista exacta).
`desde`/`hasta` son ISO 8601 opcionales en casi todos los endpoints con
periodo — sin ellos, el backend usa por defecto una ventana hasta la
**fecha de referencia** (`datosHasta`: el `max(admittedAt)` de los datos
importados, no `now()` — los datos del HIS terminan el 2026-09-21).

### Dashboard general
`GET /dashboard/summary` (`dashboard:read`). Pinta: ingresos 24h/7d/periodo,
censo y ocupación globales (`occupancy.occupancyPct`, puede ser
`'insufficient_data'` si no hay camas físicas), `waitTimeP50Minutes`, y —solo
si el objeto existe— alertas abiertas por severidad (`alerts.WARNING`/
`.CRITICAL`).

### Ocupación
`GET /dashboard/occupancy` (`dashboard:read` + `services:read`). `porUnidad`:
tabla con `unit`, `physicalBeds`, `census`, `virtualCensus`, `occupancyPct`.
`serieDiaria`: gráfico de línea/área con `day`/`census`/`occupancyPct`. Ver
§8 para pintar el `occupancyPct` > 100 %.

### Esperas
`GET /dashboard/wait-times` (`dashboard:read` + `services:read`). `porNivel`:
tabla o barras por nivel de triage (`level` 1–4 en los datos reales) con `n`,
`p50`, `p90`, `avg` en minutos. `serieDiaria`: línea de `p50` por día.

### Demanda
`GET /dashboard/demand` (`dashboard:read` + `services:read`). `porDiaYUnidad`
(serie apilada por unidad), `porViaIngreso` (dona/barras: Urgencias, Cirugía
Ambulatoria, Remitido), `perfilHorario` (0–23h, barras), `cambioPorUnidad`
(`last7`/`prev7`/`changePct`, `'insufficient_data'` si `prev7` es 0 — no
dividas por cero en el cliente tampoco).

### Analítica de servicios y triage
`GET /analytics/services` (`analytics:read` + `services:read`):
`porAreaEspecialidad` (tabla), `topProcedimientos` (top 10, con nombre desde
el catálogo), `serieDiaria`. `GET /analytics/triage` (mismos permisos):
`porNivel`, `porClasificacion` (texto libre del HIS, úsalo tal cual),
`perfilHorario`, `esperaPorNivel`. Ambos con exportación CSV (ver §9),
detrás de `analytics:export` además de los dos anteriores.

### Medicamentos
`GET /medications` (`medications:read`, paginado por página, admite
`search` y `kind=medicamento|insumo`): tabla con `code`, `name`, `kind`,
`quantity`/`lines` del periodo, `stock`, `daysOfInventory`, `risk`
(`CRITICAL`/`LOW`/`OK`/`'insufficient_data'`). `GET /medications/critical`:
lista ya filtrada a `CRITICAL`/`LOW`, o
`{ status: 'insufficient_data', items: [] }` si nadie ha registrado stock
todavía — pinta un estado vacío explicativo, no una tabla vacía muda.
`GET /medications/consumption`: serie + top 10 + desglose por área.
`PUT /medications/{code}/stock` (**solo** `medications:manage`, o sea
FARMACIA/ADMIN/SUPER_ADMIN): formulario con un único campo `quantity`
(entero ≥ 0); es upsert, así que sirve tanto para registrar como corregir.

### Cirugías
`GET /analytics/surgeries` (`analytics:read` + `surgeries:read`, **sin**
parámetros de periodo: `ProgramacionCirugia` no trae fecha en el HIS).
Pinta `totalSchedules`, `distinctProcedures`,
`withAdmissionInExtract.pct`, y sobre todo `verifiable.executedPct`/
`notExecutedPct` con una nota clara: son porcentajes **solo sobre las
programaciones verificables** (las que tienen ingreso en el extracto), no
sobre el total — `unknown` (9.506 de 12.770 en los datos reales) es el resto,
"sin ingreso verificable", no "canceladas". `topProcedures`, `byUnit`.

### Alertas
`GET /alerts` (`alerts:read`, cursor, filtros `status`/`severity`/`type`/
`scope`) — recuerda que ya viene filtrado por ámbito (§5). `GET /alerts/{id}`.
`PATCH /alerts/{id}` (`alerts:manage`, body `{ status: 'ACKNOWLEDGED' |
'RESOLVED' }`): botones "reconocer"/"resolver" según `TRANSICIONES_VALIDAS`
(`OPEN→ACKNOWLEDGED`, `OPEN→RESOLVED`, `ACKNOWLEDGED→RESOLVED`; cualquier otra
combinación da `409 CONFLICT`, deshabilita el botón que no aplique en vez de
dejar que falle). Ver §9 para generar alertas de demo.

### Asistente
`POST /assistant/query` (`assistant:use`, body `{ question: string }`,
3–500 caracteres). Respuesta: `{ status: 'ok' | 'cannot_answer', answer,
queries }`. Pinta `answer` como el mensaje del asistente; si quieres mostrar
datos "de verdad" (tabla, gráfico), usa `queries[].rows`/`columns` — son las
filas que **Node** ejecutó, nunca una alucinación de Python. Con
`assistant:advanced` (DIRECTOR, ADMIN, SUPER_ADMIN) el usuario tiene más
cupo de consultas por pregunta; no hay nada que cambiar en el cliente para
eso, es transparente. Ejemplo real capturado en local:

```json
{"status":"ok","answer":"Segun \"admissions\" (5 fila(s), truncado=false): triage_level=null, avg_wait_minutes=null | triage_level=1, avg_wait_minutes=26.72... | ...",
 "queries":[{"query":{"dataset":"admissions","metrics":[{"agg":"avg","field":"wait_minutes"}],"groupBy":[{"field":"triage_level"}]},
 "columns":["triage_level","avg_wait_minutes"],"rows":[{"triage_level":1,"avg_wait_minutes":26.72},{"triage_level":2,"avg_wait_minutes":47.84}],"rowCount":5,"truncated":false}]}
```

### Administración de usuarios y roles
Solo con `users:*`/`roles:*`/`permissions:read`/`audit:read` (ADMIN,
SUPER_ADMIN). `GET /users` (cursor o página), `POST /users` (con `roles: []`
al crear — asignar un rol exige que el actor ya posea todos sus permisos),
`PATCH /users/{id}`, `DELETE /users/{id}` (borrado lógico, `204`),
`PUT /users/{id}/roles` (reemplaza el set completo, doble guarda de
no-escalada: **nadie edita sus propios roles**, ni el superadmin — oculta ese
botón cuando `id === sesión actual`). `GET /roles`, `PUT /roles/{id}/permissions`
(los roles de sistema —`isSystem: true`— son inmutables por API: deshabilita
edición si el rol lo trae). `GET /permissions` (catálogo agrupado, para
poblar checkboxes). `GET /audit` (solo lectura, útil como pantalla de
"actividad reciente").

---

## 7. `insufficient_data` y la ocupación por encima del 100 %

**`insufficient_data`** aparece en vez de un número cuando el dato no es
calculable, no cuando es cero. Ejemplos reales: `daysOfInventory` de un
medicamento sin stock registrado, `occupancyPct` con 0 camas físicas,
`changePct` de demanda con `prev7 = 0`, todo el bloque de
`medications/critical` sin ningún stock. **Trátalo como un tercer estado**,
no como `null`/`0`:

```tsx
function Metric({ value }: { value: number | 'insufficient_data' }) {
  if (value === 'insufficient_data') return <span className="text-muted">Sin datos suficientes</span>;
  return <span>{value.toFixed(1)}%</span>;
}
```

No lo redondees a 0 ni lo ocultes en silencio: es información ("todavía nadie
registró stock de este medicamento"), no un error.

**Ocupación por encima del 100 % es real, no un bug.** El HIS no tiene fecha
de egreso: la ocupación es una estimación (`metodo:
"censo_estimado_ultima_actividad"`, siempre presente en la respuesta —
píntalo como nota al pie del gráfico) y la capacidad son las camas
**físicas** de la unidad, pero el censo cuenta también los ingresos en camas
**virtuales** (`virtualCensus`). Con datos reales, `HOSPITALIZACION` está al
113,95 % y `PEDIATRIA` al 121,05 %. No cortes el eje Y en 100: dale margen
(120–150 % mínimo) y considera un color de alerta por encima de
`ALERT_OCCUPANCY_PCT`/`ALERT_CRITICAL_OCCUPANCY_PCT` (85 %/95 % por defecto)
en vez de asumir que 100 % es el máximo del gráfico.

---

## 8. Cómo provocar una alerta en la demo

El motor de reglas ya corre solo: se evalúa al arrancar el servidor y cada
`ALERT_EVAL_INTERVAL_MINUTES` (15 por defecto, `alerts.job.ts`), así que en
cuanto hay datos importados normalmente ya hay alertas de ocupación/demanda/
cirugía abiertas (dependen solo del HIS, no de que FARMACIA haga nada). Lo
único que **no** se genera solo es `LOW_STOCK`, porque depende de un stock
que nadie ha registrado todavía. Para forzarlo en la demo:

1. Inicia sesión como **FARMACIA** (`farmacia@hospital.test`).
2. Elige un código con consumo alto y reciente (para que el umbral de "días
   de inventario" tenga sentido), por ejemplo el top de
   `GET /medications/consumption`, y regístrale un stock bajo:
   ```bash
   curl -b cookies-farmacia.txt -H 'Content-Type: application/json' -H 'Origin: http://localhost:5173' \
     -X PUT http://localhost:3000/api/v1/medications/N02BA001400/stock -d '{"quantity": 10}'
   ```
3. Dispara la evaluación a mano (no hace falta esperar los 15 minutos del job):
   ```bash
   curl -b cookies-farmacia.txt -H 'Content-Type: application/json' -H 'Origin: http://localhost:5173' \
     -X POST http://localhost:3000/api/v1/alerts/evaluate -d '{}'
   ```
   Responde `{ creadas, actualizadas, resueltas, evaluadoEn }` (permiso
   `alerts:manage`, sin body; misma evaluación que corre el job periódico,
   y queda auditada como `alert.evaluated`).
4. `GET /alerts?type=LOW_STOCK` como FARMACIA ya la muestra.

Ejemplo real, capturado en `hospital_local` con exactamente estos pasos
(`ACETAMINOFEN 500 mg TABLETA`, consumo medio ~497,5/día, stock puesto a 10):

```json
// PUT /medications/N02BA001400/stock {"quantity":10}
{"success":true,"data":{"code":"N02BA001400","quantity":10,"updatedAt":"2026-09-24T01:15:22.889Z"}}

// POST /alerts/evaluate
{"success":true,"data":{"creadas":1,"actualizadas":6,"resueltas":0,"evaluadoEn":"2026-09-24T01:15:23.001Z"}}

// GET /alerts?type=LOW_STOCK (como FARMACIA)
{"success":true,"data":[{"id":"6db6b455-...","type":"LOW_STOCK","severity":"CRITICAL","status":"OPEN",
  "scope":"medication","scopeId":"N02BA001400","metric":"medication.daysOfInventory","value":0,"threshold":3,
  "message":"Dias de inventario de ACETAMINOFEN 500 mg TABLETA: 0.0 por debajo del umbral de 3.",
  "firstSeenAt":"2026-09-24T01:15:22.998Z","lastSeenAt":"2026-09-24T01:15:22.998Z",
  "acknowledgedAt":null,"resolvedAt":null}],
 "pagination":{"limit":20,"hasNext":false,"nextCursor":null}}
```

`actualizadas: 6` en la misma pasada son las alertas de ocupación/demanda/
cirugía que el job ya había creado al arrancar (`HIGH_OCCUPANCY` en
`PEDIATRIA`/`UNIDAD DE CUIDADO BASICO`/`URGENCIAS`, `DEMAND_SPIKE` en
`UNIDAD DE CUIDADO INTENSIVO`, `SURGERY_CANCELLATIONS`): con solo cargar los
datos reales y arrancar el servidor, el panel de alertas ya no está vacío.
`GET /alerts` sin filtro, con un rol de ámbito amplio (ADMIN/SUPER_ADMIN o
DIRECTOR), las muestra todas; FARMACIA solo ve `scope: "medication"`.

---

## 9. Descarga de CSV

`GET /analytics/services/export`, `/analytics/triage/export` y
`/analytics/surgeries/export` (los tres exigen además `analytics:export`) no
devuelven el contrato JSON: son un adjunto (`Content-Type: text/csv`,
`Content-Disposition: attachment`). Con `fetch`, no hagas `res.json()`:

```ts
const res = await fetch(`${API}/analytics/services/export?desde=...&hasta=...`, { credentials: 'include' });
if (!res.ok) { /* aquí sí es JSON: manéjalo como el resto de errores */ }
const blob = await res.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'servicios.csv'; // el nombre real lo trae el header Content-Disposition
a.click();
URL.revokeObjectURL(url);
```

O, más simple, un `<a href="{API}/analytics/services/export?..." download>`
si la sesión viaja en cookie del mismo sitio (mismo dominio o `SameSite=lax`
con navegación top-level, no un `fetch` cross-site).

---

## 10. Qué hacer con 401 / 403 / 429

- **401** (`UNAUTHORIZED`/`TOKEN_INVALID`): sesión ausente o caducada.
  Redirige a login. No reintentes automáticamente: Better Auth no tiene
  refresh token rotativo, la sesión se renueva sola mientras se usa
  (`updateAge`); un 401 significa que hay que volver a autenticar, punto.
- **403** (`FORBIDDEN`/`INSUFFICIENT_PERMISSIONS`): el usuario no tiene el
  permiso. No es un error transitorio — no reintentes, y mejor evita que
  ocurra ocultando la acción de antemano según `permissions` de
  `GET /users/me`.
- **429** (`RATE_LIMITED`): backoff. Los límites relevantes desde el
  frontend son `RATE_LIMIT_MAX` (global), `AUTH_SIGNIN_MAX` (login, por IP,
  ventana corta) y `ASSISTANT_RATE_LIMIT_MAX` (preguntas al asistente, por
  usuario). Muestra "demasiadas peticiones, espera un momento" en vez de
  reintentar en bucle; no hay cabecera `Retry-After` en la respuesta hoy, así
  que usa un backoff fijo razonable (unos segundos) en el cliente.
