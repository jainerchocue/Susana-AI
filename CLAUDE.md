# Reglas del proyecto

Estas reglas son **obligatorias** para cualquier código generado por una IA en este
repositorio. Si una regla y una petición se contradicen, avisa antes de romper la regla.

---

## 0. Antes de escribir código

1. Lee el módulo que vas a tocar completo. No inventes helpers que ya existen.
2. Si necesitas una utilidad genérica, búscala primero en `src/core/`.
3. Si el cambio toca el modelo de datos, empieza por `prisma/schema.prisma` y genera migración.
4. **No añadas dependencias** sin justificarlo. Node ≥22 trae `fetch`, `crypto`,
   `fs.readdirSync({recursive})` y `process.loadEnvFile`. Úsalos.

---

## 1. Estructura de carpetas

```
src/
  config/        env.ts (Zod) y constants.ts (marca, tema, textos). Nada más.
  core/          Infraestructura reutilizable. No conoce ningún módulo de negocio.
    auth/        Configuración de Better Auth. La ÚNICA autenticación.
    db/          Cliente Prisma.
    http/        Contrato de respuesta, AppError, códigos HTTP y de error.
    audit/       Registro append-only de acciones sensibles + RequestMeta.
    cache/       Cliente Redis (degrada a memoria en desarrollo).
    jobs/        Purga de sesiones y verificaciones caducadas.
    mail/        Envío con Resend + plantillas.
    openapi/     Contrato derivado de los schemas de Zod.
    middleware/  authenticate, authorize, validate, error-handler, rate-limit.
    rbac/        Catálogo de permisos, guardas de no-escalada y caché.
    router/      Autoload de rutas.
    security/    Hash de contraseñas (scrypt con semáforo).
  modules/       Negocio. Una carpeta por dominio.
    <dominio>/
      <dominio>.routes.ts       ← se monta solo (autoload)
      <dominio>.controller.ts   ← lee req, llama al servicio, responde
      <dominio>.service.ts      ← toda la lógica y todo el acceso a Prisma
      <dominio>.schemas.ts      ← esquemas Zod de entrada
      <dominio>.mapper.ts       ← (opcional) entidad → forma pública
prisma/          schema.prisma + seed.ts
```

**Dirección de las dependencias:** `modules → core → config`. Nunca al revés.
`core/` jamás importa de `modules/`.

---

## 2. Rutas: carga dinámica

- Todo archivo `*.routes.ts` bajo `src/modules/` se monta **automáticamente**.
- El prefijo sale de la carpeta: `modules/users/users.routes.ts` → `/api/v1/users`.
- Para forzar otro prefijo: `export const basePath = '/lo-que-sea'`.
- El archivo hace `export default router`.
- ❌ **Prohibido** importar rutas a mano en `app.ts`. Si lo haces, el patrón se rompe.

Crear un módulo nuevo = crear la carpeta con sus 4 archivos. Nada más.

**Excepción: `/auth`.** No existe `modules/auth/`. Todas las rutas bajo
`{API_PREFIX}/auth/**` las sirve Better Auth desde `core/auth/auth.ts`, montado
a mano en `app.ts`. Va **antes de `express.json()`** porque su handler consume
el body crudo: si un parser lo lee primero, llega vacío y todo responde 400.
No añadas un `auth.routes.ts`; extiende la configuración de la librería.

---

## 3. Respuestas: un solo contrato

Toda respuesta usa los helpers de `src/core/http/api-response.ts`:

```ts
ok(res, data)            // 200
created(res, data)       // 201
noContent(res)           // 204
paginated(res, { items, total, page, limit })
```

Éxito:
```json
{ "success": true, "data": {...}, "meta": { "requestId": "...", "timestamp": "..." } }
```

Error (lo emite **solo** el error handler):
```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] },
  "meta": { "requestId": "...", "timestamp": "..." } }
```

Reglas:
- ❌ Nunca `res.json({...})` ni `res.send({...})` con forma libre.
- ❌ Nunca construyas un error a mano en el controlador: `throw AppError.x(...)`.
- El cliente hace `switch` sobre `error.code`, nunca sobre `error.message`.
- Añadir un código nuevo = añadirlo a `ErrorCode` en `core/http/http-status.ts`.

---

## 4. Validación

- **Toda** entrada (`body`, `query`, `params`) pasa por `validate({ ... })` con Zod.
- El handler **nunca** lee un campo que no haya sido validado.
- Zod normaliza además de validar: `.trim()`, `.toLowerCase()` en correos, `z.coerce.number()`
  en query params. Lo que devuelve Zod reemplaza al original.
- Los esquemas viven en `<dominio>.schemas.ts`. Nunca inline en la ruta.
- El tipo se **infiere** del esquema (`z.infer`), no se declara aparte.

---

## 5. Autenticación y autorización

Orden obligatorio en la cadena de middlewares:

```ts
router.patch('/:id',
  authenticate,                                 // 1. ¿quién eres?
  validate({ params: idParamSchema, body: x }), // 2. ¿los datos son válidos?
  requirePermissions(PERMISSIONS.users.update), // 3. ¿puedes hacerlo?
  controller.update,                            // 4. hazlo
);
```

- `authenticate` — exige una sesión viva de Better Auth (cookie **o**
  `Authorization: Bearer`) y revalida el estado de la cuenta contra la BD en
  cada petición. Rellena `req.auth` con roles y permisos efectivos.
- `requirePermissions(p | p[], { mode: 'all' | 'any' })` — la forma **preferida**.
- `requireRoles(...)` — solo para puertas gruesas. Los roles cambian; los permisos son el contrato.
- `requireOwnershipOr(permiso, getOwnerId)` — permiso administrativo **o** ser el dueño.
- `requireVerifiedEmail` — cuando la acción exige correo confirmado.

### Autenticación: Better Auth, solo credenciales

`core/auth/auth.ts` es el único sitio donde se configura la autenticación.

- **Solo email + contraseña.** Nada de OAuth social, magic link ni passkey. Para
  añadir un método hay que justificarlo: cada uno es superficie nueva.
- El hash de la contraseña vive en `Account.password`, **no** en `User`. Lo
  genera nuestro `hashPassword` (con su semáforo) enchufado en los hooks
  `password.hash`/`verify` de la librería. No lo sustituyas por el scrypt por
  defecto: no tiene semáforo.
- Segundo factor con el plugin `twoFactor`. Trae contador de fallos y bloqueo
  por cuenta (`failedVerificationCount`, `lockedUntil`).
- Los límites por endpoint van en `rateLimit.customRules`, con rutas
  **relativas al basePath** (`/sign-in/email`, no `/api/v1/auth/sign-in/email`).
  Con la ruta completa ninguna regla casa y se aplica en silencio el límite por
  defecto de 3 cada 10 s, que devuelve 429 a tráfico legítimo.
- `status` y `deletedAt` son `additionalFields` con `input: false`: un cliente
  no puede colarlos en el registro. Better Auth no los conoce, así que la puerta
  para cuentas suspendidas está en el hook `session.create.before`.
- `CORS_ORIGINS` son también los `trustedOrigins` de la librería: valida contra
  esa lista el `Origin` y todo `callbackURL`/`redirectTo`. **Un valor de más ahí
  es un open redirect.**
- Regenerar el schema tras tocar plugins:
  `npx @better-auth/cli generate --config src/core/auth/auth.ts`

### Invariante de no-escalada — el más importante del proyecto

Un middleware responde a *"¿puede asignar roles?"*, **nunca** a *"¿puede asignar
**este** rol?"*. Esa diferencia fue una escalada vertical real: quien tuviera
`users:assign-roles` se concedía superadmin en una petición.

Toda operación que **conceda autoridad** pasa por `core/rbac/guards.ts`:

```ts
await assertPuedeAsignarRoles(actor, targetUserId, roles);   // users.service
assertPuedeAsignarPermisos(actor, rol, permisos);            // roles.service
await assertPuedeAdministrarUsuario(actor, targetUserId);    // suspender/borrar
```

Reglas que garantizan:
1. Nadie edita sus propios roles (ni el superadmin: obliga a cuatro ojos).
2. Nadie concede un permiso que no posee.
3. El comodín `*` no se asigna por API, solo por seed.
4. Los roles de sistema son inmutables por API.
5. Nadie administra a un usuario con más privilegios que él.

❌ **Nunca** escribas un `setRoles`/`setPermissions` nuevo sin su guarda.
Cambiar `core/rbac/` o los servicios de `users`/`roles` exige un test de
regresión en `tests/security/escalada.test.ts` que falle antes y pase después.

Reglas duras:
- ❌ **Nunca** escribas el string del permiso suelto: usa `PERMISSIONS.recurso.accion`.
- Un permiso nuevo se añade a `core/rbac/permissions.ts` y se corre `npm run db:seed`.
- Formato de permiso: `recurso:accion` en minúsculas. `*` es el comodín (superadmin).
- ❌ **Nunca** compruebes permisos dentro del controlador o del servicio. Solo middleware.
- Toda ruta que no sea explícitamente pública lleva `authenticate`.

---

## 6. Servicios y acceso a datos

- **Todo** Prisma vive en `*.service.ts`. Un controlador nunca importa `prisma`.
- Un controlador no tiene `if` de negocio: lee, delega, responde.
- Operaciones multi-tabla van en `prisma.$transaction`.
- ❌ Nunca `$queryRawUnsafe` ni SQL concatenado. `$queryRaw` con template tag si hace falta.
- Los borrados de entidades con historial son **lógicos** (`deletedAt`), no físicos.
- Toda consulta que devuelva usuarios filtra `deletedAt: null`.

---

## 7. Seguridad — no negociable

- ❌ Jamás devuelvas la entidad de Prisma cruda. Pasa por el mapper (`toPublicUser`, etc.).
  El hash de la contraseña vive en `Account.password` y **nunca** sale de la API.
- Contraseñas: solo `hashPassword` / `verifyPassword` de `core/security/password.ts`,
  que es lo que Better Auth tiene enchufado. No llames al scrypt de la librería.
- Los tokens de sesión y de verificación los genera y guarda Better Auth, hasheados.
  ❌ No los leas ni los compares a mano.
- Mensajes anti-enumeración: los de `/auth/**` los da la librería. En lo nuestro,
  una respuesta nunca debe delatar si una cuenta existe.
- Comparaciones de secretos: `crypto.timingSafeEqual`. Nunca `===`.
- Toda la superficie de `/auth` lleva `authRateLimit` en el borde (por IP) más los
  límites por endpoint de `rateLimit.customRules`.
- ❌ Nunca loguees contraseñas, tokens, cookies ni `Authorization`. El logger ya los redacta;
  no lo esquives con `console.log`.
- Un 500 nunca filtra el mensaje interno al cliente en producción.

---

## 8. Configuración

- `process.env` se lee **solo** en `src/config/env.ts`. En cualquier otro archivo: `import { env }`.
- Variable nueva = añadirla al esquema Zod de `env.ts` **y** a `.env.example`.
- Nada de valores por defecto inseguros para producción: el esquema falla al arrancar.
- Marca, colores y textos de email: **solo** `src/config/constants.ts`.

---

## 9. Emails

- El transporte es **Resend**. `sendMail` acepta `dedupeKey` para no bombardear
  al usuario si reintenta un formulario.
- El HTML se construye con los helpers de `core/mail/templates/layout.ts`
  (`paragraph`, `button`, `infoBox`, `fallbackLink`).
- ❌ Nunca escribas HTML de email en un servicio ni concatenes strings de marca.
- Toda plantilla devuelve `{ subject, html, text }`. La versión `text` es obligatoria.
- Todo dato de usuario interpolado pasa por `escapeHtml`.
- `sendMail` nunca lanza: un fallo SMTP no debe tumbar una operación exitosa.

---

## 10. Errores

- Los servicios lanzan `AppError`. Nada más.
- El `errorHandler` traduce Zod y Prisma (`P2002`, `P2025`, `P2003`) automáticamente:
  no captures esos errores a mano en el servicio.
- Express 5 propaga los rechazos de handlers `async`: **no** envuelvas en `try/catch`
  solo para hacer `next(error)`.
- ❌ Nunca `catch {}` vacío. Si tragas un error, deja un comentario diciendo por qué.

---

## 11. TypeScript

- `strict` activo. ❌ Nada de `any`; si es inevitable, `unknown` + estrechamiento.
- ❌ Nada de `@ts-ignore`. `@ts-expect-error` con comentario justificando, y solo si no hay salida.
- ❌ Nada de aserciones `as` para callar al compilador; arregla el tipo.
- Los tipos de entrada se **infieren** de Zod. Los de salida se declaran explícitos
  (`PublicUser`, `PublicRole`) para que un cambio en Prisma no filtre campos nuevos sin querer.
- Imports relativos. No hay alias de paths (rompen `node dist/`).

---

## 12. Estilo

- Español en comentarios, mensajes de error y nombres de dominio. Inglés en identificadores
  técnicos y nombres de la API (rutas, campos JSON).
- Comenta el **porqué**, no el qué. Un comentario que repite el código sobra.
- Función que no cabe en una pantalla → pártela.
- Sin abstracción especulativa: nada de interfaz con una sola implementación,
  factory de un solo producto ni config para un valor que nunca cambia.
- Un atajo deliberado se marca con `// ponytail: <qué se simplificó, cuándo mejorarlo>`.

---

## 13. Antes de dar algo por terminado

```bash
npm run lint        # 0 errores
npm run typecheck   # debe pasar limpio
npm test            # todos en verde
npm run build       # debe compilar
npm run audit:prod  # 0 CVE altas en dependencias de producción
```

- Si tocaste el schema: `npm run db:migrate`.
- Si añadiste permisos o roles: `npm run db:seed`.
- Si tocaste plugins de Better Auth: regenera el schema
  (`npx @better-auth/cli generate --config src/core/auth/auth.ts`) y migra.
- No afirmes que algo funciona sin haber corrido el comando y visto la salida.

---

## 14. Lista de verificación para un módulo nuevo

- [ ] Carpeta `src/modules/<dominio>/` con `routes`, `controller`, `service`, `schemas`.
- [ ] `export default router` en el archivo de rutas.
- [ ] Permisos nuevos declarados en `core/rbac/permissions.ts` y sembrados.
- [ ] Toda ruta con `authenticate` + `validate` + `requirePermissions` en ese orden.
- [ ] Respuestas con `ok`/`created`/`paginated`. Errores con `AppError`.
- [ ] Mapper si el módulo devuelve entidades con campos sensibles.
- [ ] Auditoría (`auditar` / `auditarEnTx`) en toda acción que cambie autoridad,
      credenciales o estado de cuenta.
- [ ] Ruta añadida a `core/openapi/registry.ts`.
- [ ] `npm run lint` y `npm run typecheck` limpios, `npm test` en verde.


---

## 15. Lo que NO se puede tocar sin justificarlo

Estos elementos existen porque un fallo real los hizo necesarios. Quitarlos
reabre una vulnerabilidad concreta:

| Elemento | Qué previene |
|---|---|
| `core/rbac/guards.ts` | Escalada vertical: `users:assign-roles` → superadmin |
| **Las DOS guardas de `setRoles()`** | `assertPuedeAsignarRoles` frena la escalada; `assertPuedeAdministrarUsuario` frena lo contrario: un actor con solo `users:assign-roles` mandaba `roles: []` contra el superadmin y lo dejaba sin autoridad ni sesiones (200 OK, verificado). Su orden fija el código de estado |
| Semáforo de `password.ts`, enchufado en `password.hash`/`verify` | 16 req/s congelaban el threadpool de libuv (y con él, fs y DNS) |
| Hook `session.create.before` | Better Auth no conoce `status`: sin él, una cuenta suspendida sigue abriendo sesiones |
| `input: false` en `status`/`deletedAt` | Mass assignment por la vía de la librería |
| `verificarOrigen` aplicado en `app.ts` a toda la API | Con sesiones en cookie, **toda** ruta mutante es objetivo de CSRF, no solo las de auth. Cierra en fallo: exige `Origin` si hay cookie de sesión |
| `skip` de health en `globalRateLimit` | Un 429 en el liveness reinicia el contenedor en bucle |
| `updateMeSchema` separado de `updateUserSchema` | Mass assignment de `status` |
| `.strict()` en los schemas | Campos desconocidos se descartaban en silencio |
| `urlSegura` en vez de `z.string().url()` | `javascript:` almacenado y servido al frontend |
| CHECK `users_email_minusculas` | `A@x.com` y `a@x.com` como cuentas distintas |
| Índices trigrama declarados en `schema.prisma` | Escritos a mano en un `.sql`, la siguiente migración los borra como «deriva». Ya pasó: `users_email_trgm_idx` desapareció y reabrió el Seq Scan de C-06 sin que nadie lo notara |
| Trigger `audit_logs_inmutable` | Un atacante borrando sus huellas |
| `actorEmail` rellenado en `core/audit/audit.ts` | La columna existía y **nadie la escribía** (0 de 55 filas). Al borrar al actor, su rastro quedaba en un UUID huérfano |
| Clave **solo por IP** en `authRateLimit` | La clave compuesta `ip\|cuenta` aplicaba el límite al par: una IP contra 1.000 cuentas tenía 1.000 cupos y el password spraying pasaba entero |
| `increment` con Lua en el `secondaryStorage` | INCR + EXPIRE en dos viajes puede dejar el contador sin caducidad y bloquear la clave para siempre |

Si un cambio exige tocar alguno, explica en el PR qué lo sustituye.

### Dado de baja al migrar a Better Auth

Estos tres eran invariantes propios y **ya no existen**. Se documenta la baja
porque cada uno cerraba un fallo real y conviene saber qué ocupa su lugar:

| Se quitó | Por qué | Qué lo cubre ahora |
|---|---|---|
| CAS en `refresh()` (`updateMany` condicional) | Better Auth no usa refresh tokens rotativos: renueva la propia sesión. No hay carrera que resolver | Modelo de sesión de la librería (`expiresIn` + `updateAge`) |
| `ReusoDetectado` fuera de la transacción | Sin rotación no hay token viejo que reusar | Nada equivalente: **se acepta la pérdida.** Un token robado vale hasta que caduque o se revoque |
| Estado comprobado **antes** que la contraseña en `login()` | El login lo sirve la librería; no controlamos ese orden | Sus protecciones anti-enumeración (respuestas constantes, operaciones dummy) + el hook `session.create.before` |

La tercera es la más sensible: el oráculo de cuenta bloqueada se cerraba con ese
orden. Ya no hay bloqueo por intentos fallidos (lo sustituye el rate limit por
IP y endpoint), así que no hay estado «bloqueada» que delatar — pero sí existe
«suspendida», y su respuesta la decide Better Auth, no nosotros.
