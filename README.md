# Hospital Intelligence — Frontend

Centro de Inteligencia Operativa Hospitalaria para el Hospital Susana López de
Valencia. Prototipo de frontend que consolida ocupación, tiempos de espera,
demanda, farmacia, analítica de servicios/triage/cirugías, alertas operativas
y un asistente de IA consultivo, todo sobre un backend real que actúa como
autoridad de datos, autenticación, RBAC y auditoría.

Este repositorio contiene **únicamente el frontend**. No implementa lógica de
negocio crítica: valida en el cliente por UX, pero toda autorización real,
validación y persistencia vive en el backend.

## Stack

- React 19 + TypeScript + Vite
- TailwindCSS v4
- React Router v7
- TanStack Query v5
- Recharts
- React Hook Form + Zod
- Zustand (estado de sesión, sin persistencia)
- Vitest + Testing Library

## Arquitectura

```
React (este repo)
   │  axios, siempre a través de src/services/api/*
   ▼
Backend real (autoridad de auth vía Better Auth, RBAC, permisos, validación, datos, auditoría)
```

React **nunca** llama directamente a la base de datos ni a un proveedor de IA
— todo pasa por el backend. El contrato completo de la API vive en
[`api.md`](./api.md) (y en `GET /api/v1/openapi.json`, que manda si difieren).

```
src/
├── app/            # router, providers (TanStack Query), store (zustand)
├── components/      # ui, charts, dashboard, chat, alerts, tables, layout, filters
├── features/        # auth, dashboard, analytics, medications, services, surgeries, alerts, assistant
├── pages/            # una carpeta por ruta (Login, Dashboard, Analytics, Medications, Services, Alerts, Assistant, Settings)
├── services/api/     # única capa que habla con el backend
├── hooks/            # hooks compartidos (useGlobalFilters)
├── types/            # tipos que reflejan las formas reales del backend
├── schemas/          # validación Zod para formularios
├── constants/         # permisos, rutas, query keys, etiquetas de rol/alerta
└── utils/            # formato, errores, cn
```

## Cómo correr el proyecto

```bash
npm install
cp .env.example .env   # y ajusta VITE_API_BASE_URL al backend real
npm run dev
```

`VITE_API_BASE_URL` debe incluir el prefijo `/api/v1` (p. ej.
`https://tu-backend/api/v1`). Sin un backend real detrás, verás un `401`
en la consola al cargar `/login` (intento silencioso de restaurar sesión) —
es esperado, la app lo captura y muestra el formulario de login.

Scripts disponibles:

| Script              | Descripción                                   |
| ------------------- | ---------------------------------------------- |
| `npm run dev`        | Servidor de desarrollo (Vite)                  |
| `npm run build`       | Typecheck (`tsc -b`) + build de producción      |
| `npm run preview`      | Sirve el build de producción localmente         |
| `npm run test`        | Corre la suite de Vitest una vez                |
| `npm run test:watch`   | Vitest en modo watch                            |
| `npm run test:ui`      | Vitest con su interfaz visual                   |
| `npm run typecheck`    | Solo typecheck, sin emitir                      |
| `npm run lint`        | oxlint sobre `src/`                             |

## Autenticación y sesión

El backend usa **Better Auth** montado en `/auth/**`. Según api.md la sesión
"viaja en cookie httpOnly (web) o en Authorization: Bearer (móvil/servicio a
servicio)" — en la práctica, **verificado contra el backend real**, la cookie
que emite Better Auth es `SameSite=Lax` sin `Secure`/`Partitioned`, así que en
cualquier despliegue cross-site (frontend y backend en dominios distintos,
como este repo contra un túnel de desarrollo) el navegador la descarta por
completo: no sobrevive a peticiones `fetch`/XHR de otro origen. Por eso este
frontend usa el **bearer token** como mecanismo real de sesión:

- Login: `POST /auth/sign-in/email` — responde con la forma propia de Better
  Auth (`{redirect, token, user}`), **no** el envelope `{success,data,meta}`
  del resto de la API. El `token` se guarda en memoria (Zustand, nunca en
  `localStorage`) y `apiClient.ts` lo adjunta como `Authorization: Bearer` en
  cada petición (además de mantener `withCredentials: true`, que sí funciona
  en un despliegue same-site).
- Sesión + permisos: `GET /users/me` (envelope normal) — única fuente de
  verdad de "¿quién soy y qué puedo hacer". Se llama justo tras el login
  (con el bearer recién obtenido) y de nuevo al recargar la página
  (`useSessionBootstrap`, que solo tiene la cookie disponible — en este
  cross-origin fallará y volverá a mostrar el login; en un despliegue
  same-site funcionaría sola).
- Logout: `POST /auth/sign-out`.
- No existe endpoint de refresh: la sesión se renueva sola en el backend
  (`updateAge`). Un `401` en cualquier petición limpia el estado local y
  `ProtectedRoute` redirige a `/login`.
- `apiClient.ts` distingue el formato de error de Better Auth
  (`{code,message}`) del envelope normal (`{success:false,error}`) para
  mostrar siempre el mensaje real del backend.

> Si el frontend se despliega en el mismo dominio (o subdominio) que el
> backend en producción, la cookie `SameSite=Lax` funcionaría sola y el
> bearer token pasaría a ser redundante-pero-inofensivo. El código ya soporta
> ambos casos sin cambios.

## RBAC

`GET /users/me` responde `roles: string[]` y `permissions: string[]` — ambos
son datos dinámicos del backend (roles administrables vía `POST /roles`,
catálogo completo de permisos en `GET /permissions`), no un enum fijo del
frontend. `src/constants/permissions.ts` solo lista los permisos que esta UI
necesita para sus guardas; `roleLabel()` traduce los roles de sistema
conocidos y muestra el resto tal cual.

El rol de super-administrador (verificado con la cuenta de prueba real) trae
`permissions: ["*"]` — el comodín documentado en api.md ("no se puede asignar
por API", reservado al rol de sistema). `src/utils/permissions.ts` centraliza
el chequeo para que `"*"` signifique "todos los permisos" en todo el
frontend (store, sidebar, redirección post-login); sin este helper un
superadmin real vería el menú vacío por una comparación de string literal.

- Menú lateral dinámico (`NAV_ITEMS` filtrados por permiso; un ítem sin
  `permission` es visible para cualquier usuario autenticado, como
  Configuración).
- `<RequirePermission>` / `<RequireRole>` ocultan secciones según
  `permissions`/`roles` de la sesión.
- Tras el login, el usuario aterriza en la primera sección de `NAV_ITEMS` a
  la que sí tiene acceso (no siempre el Dashboard — p. ej. el rol de prueba
  FARMACIA no tiene `dashboard:read` y aterriza en Medicamentos).

**Importante:** esto es control de interfaz únicamente. El backend vuelve a
validar cada petición de forma independiente.

## Contrato con el backend

Envelope real (`core/http/api-response.ts`, ver `api.md`):

```json
{ "success": true, "data": { "...": "..." }, "meta": { "requestId": "...", "timestamp": "..." } }
```

Paginado (cursor en alertas/auditoría, página en medicamentos/roles):

```json
{
  "success": true,
  "data": [{ "...": "..." }],
  "pagination": { "limit": 20, "hasNext": true, "nextCursor": "..." },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

Error (solo lo emite el error handler, nunca un controlador):

```json
{
  "success": false,
  "error": { "code": "INSUFFICIENT_PERMISSIONS", "message": "...", "details": [] },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

El frontend hace `switch` sobre `error.code`, nunca sobre `error.message`.
Ver `src/types/api.ts` y `src/services/api/*` para los contratos exactos por
endpoint, y `api.md` para la documentación completa con ejemplos reales.

## Módulos y su fuente de datos real

- **Dashboard**: `/dashboard/summary|occupancy|wait-times|demand`. Los KPIs
  de la fila superior se derivan localmente de esos números (el backend no
  manda KPIs pre-armados) — ver `buildDashboardKpis`.
- **Analítica**: `/analytics/services` (volumen por área/especialidad),
  `/analytics/triage` (distribución y clasificación) y `/analytics/surgeries`
  (agregados de ejecución quirúrgica, sin período — el HIS no trae fecha de
  cirugía). Exportación CSV vía `analytics:export`.
- **Servicios**: `/dashboard/occupancy` por unidad (no existe un endpoint de
  "servicios" propio) más el desglose de cirugías por unidad de
  `/analytics/surgeries`.
- **Medicamentos**: `/medications` (código, riesgo, rotación, días de
  inventario — pueden venir `'insufficient_data'` si no hay stock
  registrado), `/medications/critical`, y edición de stock
  (`PUT /medications/{code}/stock`) si el usuario tiene `medications:manage`.
  `risk`/`rotation` son enums en **mayúsculas** (`"CRITICAL"`, confirmado
  contra datos reales — api.md solo documentaba el caso `'insufficient_data'`
  sin stock registrado). El badge de riesgo tiene un fallback defensivo para
  cualquier valor no mapeado explícitamente, en vez de asumir el enum es
  exhaustivo.
- **Alertas**: `/alerts`, severidad `WARNING|CRITICAL`, estado
  `OPEN|ACKNOWLEDGED|RESOLVED` transicionado vía `PATCH /alerts/{id}`, con
  `medications:manage`/`alerts:manage` según corresponda.
- **Asistente**: único endpoint `POST /assistant/query` — responde texto más
  las queries ejecutadas (columnas/filas), no bloques estructurados. No
  existen `/assistant/suggestions` ni `/assistant/history`: las preguntas
  sugeridas son una lista fija del frontend y no hay historial persistido.

## Estado de UI

Todo módulo que depende de datos remotos contempla explícitamente: loading,
success, vacío, error y sin-permiso (vía `QueryStateView`, `ErrorState`,
`EmptyState` o los props `isLoading`/`isError` de cada componente). Ninguna
pantalla queda en blanco silenciosamente.

## Seguridad

- Sin `dangerouslySetInnerHTML`.
- Sin tokens/secretos en almacenamiento del navegador: el bearer token vive
  únicamente en memoria (Zustand) y se pierde al recargar — nunca
  `localStorage`/`sessionStorage`.
- El asistente de IA nunca expone SQL ni consultas crudas en la interfaz.
- Los datos mostrados provienen siempre del backend — la UI no inventa
  cifras; ante ausencia de datos se muestra un estado vacío explícito.

## Verificación realizada

- `npm run typecheck`, `npm run build`, `npm run lint` y `npm run test` pasan
  sin errores.
- **Login real end-to-end contra el backend en vivo** con las tres cuentas de
  prueba (`SUPER_ADMIN`, `DIRECTOR`, `FARMACIA`): las 7 páginas navegadas con
  datos reales del hospital, cero errores de consola. Esto encontró y
  corrigió tres bugs reales que ningún typecheck ni mock hubiera detectado:
  1. **Cookie de sesión inservible cross-site** → se adoptó el bearer token
     (ver "Autenticación y sesión").
  2. **`MedicationsPage` crasheaba** con `risk: "CRITICAL"` real (el mapeo
     solo contemplaba minúsculas) → corregido, y los badges de alertas
     también se hicieron defensivos ante enums no mapeados.
  3. **RBAC-en-redirección**: un login exitoso siempre mandaba a `/`, pero un
     usuario sin `dashboard:read` (FARMACIA) o con el comodín `*`
     (superadmin, sin match literal) se quedaba viendo una pantalla vacía de
     "sin permiso" → corregido para aterrizar en la primera sección real del
     usuario.
  4. **La app se colgaba para siempre al recargar la página** (spinner de
     "Verificando sesión" infinito): `useSessionBootstrap` combinaba un
     `ranRef` (para no repetir el bootstrap) con una bandera `cancelled`
     limpiada en el cleanup del efecto. Bajo React StrictMode (activo en
     dev), el efecto se dispara dos veces; la limpieza del primer disparo
     marcaba `cancelled=true` *antes* de que la petición real terminara, y el
     `ranRef` bloqueaba el segundo disparo — nada volvía a mover el estado
     fuera de `'authenticating'`. Corregido quitando la bandera `cancelled`
     (las acciones de Zustand son seguras de llamar sin importar si el
     componente sigue montado, así que no hacía falta).
- Verificación de errores reales del backend: credenciales inválidas
  (mensaje real de Better Auth mostrado en la UI) y el asistente con el
  agente Python caído (`503 AGENT_UNAVAILABLE` real, con reintento en la UI).

## Pendiente / fuera de alcance de este prototipo

- Pantallas de administración de usuarios, roles y auditoría
  (`/users`, `/roles`, `/permissions`, `/audit`) existen en el backend pero
  no tienen página propia aquí — el nav original de este prototipo no las
  incluía.
- Autenticación en dos pasos (`POST /auth/two-factor/verify-totp`): el
  backend la soporta: no se implementó el segundo paso en el login.
- Streaming de respuestas del asistente: `POST /assistant/query` es
  petición/respuesta simple, no hay SSE/WebSocket que consumir todavía.
