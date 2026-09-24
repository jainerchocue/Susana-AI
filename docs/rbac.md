# RBAC — permisos y roles

Better Auth responde *quién eres*; el RBAC propio (`src/core/rbac/`)
responde *qué puedes*. Ningún controlador ni servicio comprueba permisos:
solo el middleware (`requirePermissions`, `requireRoles`, `requireOwnershipOr`),
en el orden fijo de `CLAUDE.md` §5:

```
authenticate → validate → requirePermissions(...) → controller
```

---

## Catálogo de permisos

Formato `recurso:accion`, siempre en minúsculas. `*` es el comodín exclusivo
de `SUPER_ADMIN` y **no se asigna por API**, solo por seed.

| Recurso | Acciones |
|---|---|
| `users` | `read`, `create`, `update`, `delete`, `assign-roles` |
| `roles` | `read`, `create`, `update`, `delete`, `assign-permissions` |
| `permissions` | `read` |
| `audit` | `read` |
| `system` | `manage` |
| `dashboard` | `read` |
| `analytics` | `read`, `export` |
| `assistant` | `use`, `advanced` |
| `medications` | `read`, `manage` |
| `alerts` | `read`, `manage` |
| `services` | `read` |
| `surgeries` | `read` |

Los ocho últimos recursos (`system` en adelante) son los que añade la
fundación del dominio hospitalario (T1); `users/roles/permissions/audit` ya
existían. Un permiso nuevo se declara en `core/rbac/permissions.ts`
(`PERMISSIONS` + su descripción en `DESCRIPTIONS`) y se siembra con
`npm run db:seed:dev` — nunca se escribe el string suelto en un middleware.

---

## Matriz de roles de sistema

`DEFAULT_ROLE = 'CONSULTA'`: toda cuenta nueva la recibe automáticamente (por
eso ya no es un rol vacío). Los roles de sistema son inmutables por API.

| Rol | Permisos |
|---|---|
| `SUPER_ADMIN` | `*` |
| `ADMIN` | **todos** los del catálogo, explícitos (no `*`) |
| `DIRECTOR` | `dashboard:read`, `analytics:read`, `analytics:export`, `assistant:use`, `assistant:advanced`, `alerts:read`, `services:read`, `surgeries:read`, `medications:read` |
| `JEFE_SERVICIO` | `dashboard:read`, `analytics:read`, `assistant:use`, `alerts:read`, `alerts:manage`, `services:read`, `surgeries:read` |
| `FARMACIA` | `medications:read`, `medications:manage`, `alerts:read`, `alerts:manage`, `assistant:use` |
| `ANALISTA` | `dashboard:read`, `analytics:read`, `assistant:use`, `services:read`, `surgeries:read`, `medications:read` |
| `CONSULTA` | `dashboard:read` |

Reemplazan a los roles de la plantilla original: `superadmin → SUPER_ADMIN`,
`admin → ADMIN`, `user → CONSULTA`. `roles:manage` del enunciado del
hackathon se implementa con la granularidad ya existente
(`roles:read/create/update/delete/assign-permissions`), un superconjunto.

### Por qué `ADMIN` tiene todos los permisos explícitos (no `*`)

Es consecuencia directa de la regla 2 del invariante de no-escalada: nadie
concede un permiso que no posee. Si `ADMIN` no tuviera, por ejemplo,
`alerts:manage` o `assistant:advanced` explícitos, no podría dar de alta a un
`DIRECTOR` o un `FARMACIA` — se queda sin `*` a propósito (ese comodín es
exclusivo del seed) pero necesita poseer cada permiso que va a repartir.

`// ponytail:` el "ámbito de su servicio" de `JEFE_SERVICIO` (ver alcances
más abajo) necesita la relación usuario↔servicio de los datos HIS —
**pendiente (fase B: faltan los datos HIS)**. Hasta entonces, `alerts:read`
+ `alerts:manage` le dan visión y gestión de todo lo filtrado por ámbito
(`service`/`triage`), no solo "su" servicio.

---

## Invariante de no-escalada

El más importante del proyecto. Un middleware responde a *"¿puede asignar
roles?"*, **nunca** a *"¿puede asignar **este** rol?"* — esa diferencia fue
una escalada vertical real documentada en `CLAUDE.md` §15. Toda operación que
conceda autoridad pasa por `core/rbac/guards.ts`:

```ts
await assertPuedeAsignarRoles(actor, targetUserId, roles);   // users.service
assertPuedeAsignarPermisos(actor, rol, permisos);            // roles.service
await assertPuedeAdministrarUsuario(actor, targetUserId);    // suspender/borrar
```

Garantías:

1. Nadie edita sus propios roles (ni `SUPER_ADMIN`: obliga a cuatro ojos).
2. Nadie concede un permiso que no posee.
3. El comodín `*` no se asigna por API, solo por seed.
4. Los roles de sistema son inmutables por API.
5. Nadie administra a un usuario con más privilegios que él.

`setRoles()` lleva **las dos guardas**, en ese orden: `assertPuedeAsignarRoles`
frena la escalada; `assertPuedeAdministrarUsuario` frena lo contrario (un
actor con solo `users:assign-roles` mandando `roles: []` contra el
`SUPER_ADMIN` para dejarlo sin autoridad). Cambiar `core/rbac/` o los
servicios de `users`/`roles` exige un test de regresión en
`tests/security/escalada.test.ts` que falle antes del cambio y pase después.

---

## Filtrado por ámbito (no es una puerta de acceso)

`requirePermissions` decide *si* se puede entrar a un endpoint; el filtrado
por **fila** (qué alertas o qué datasets ve cada quien) es cosa del
controlador, con la única lógica de comodín fuera de `authorize.ts`:

```ts
// core/rbac/alcance.ts
export function tienePermiso(permisos: ReadonlySet<string>, permiso: string): boolean;
export function alcancesPorPermiso<T extends string>(
  permisos: ReadonlySet<string>,
  mapa: Readonly<Record<T, string>>,
): T[];
```

Dos usos concretos del diseño:

- **Alertas (T3):** `ALERT_SCOPE_PERMISSION` mapea cada ámbito
  (`medication/service/triage/surgery`) a su permiso de lectura. El
  controlador calcula `alcancesPorPermiso(req.auth!.permissions, ALERT_SCOPE_PERMISSION)`
  y se lo pasa al servicio — así `FARMACIA` (`medications:read`) solo ve
  alertas `medication`, aunque tenga `alerts:read` sobre todos los tipos.
- **Asistente (T4):** cada `Dataset` del catálogo lógico declara un
  `rowFilter` opcional (columna + función de permisos → valores permitidos);
  si la lista sale vacía, la fila `AND FALSE` en el SQL generado, nunca "sin
  filtro".

---

## Cómo añadir un permiso

1. `core/rbac/permissions.ts`: añade la clave a `PERMISSIONS` y su texto a
   `DESCRIPTIONS`.
2. Si un rol de sistema debe tenerlo, actualiza `SYSTEM_ROLES` en
   `prisma/seed.ts`.
3. `npm run db:seed:dev` (o `db:seed` compilado) para sembrarlo.
4. Si el permiso protege una ruta nueva, sigue el orden de `CLAUDE.md` §5:
   `authenticate → validate → requirePermissions(PERMISSIONS.x.y) → controller`.

No hay atajos: un permiso que no está en el catálogo no lo tiene nadie, ni
siquiera `ADMIN`.
