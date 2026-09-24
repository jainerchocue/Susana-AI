# Auditoría Enterprise — plantilla-backend

> ## ⚠ Documento histórico
>
> Refleja el estado del repositorio el **2026-08-04**, antes de dos rondas de
> cambios. No describe el código actual.
>
> - Los hallazgos C-01…C-07 y A-01…A-15 se cerraron en su momento.
> - Una segunda revisión (2026-09-10) encontró **A-16** (segundo factor sin
>   contador de fallos), **A-17** (un actor con `users:assign-roles` dejaba al
>   superadmin sin roles — verificado con 200 OK) y la **deriva de migraciones**
>   que había borrado `users_email_trgm_idx`, reabriendo media C-06.
> - La autenticación propia (JWT + refresh rotativo) se **sustituyó por Better
>   Auth** con credenciales. Tres invariantes de este documento se dieron de baja
>   a propósito: ver `CLAUDE.md` §15, «Dado de baja al migrar a Better Auth».
>
> Para el estado vigente: `CLAUDE.md` §15 y `SECURITY.md`.

**Fecha:** 2026-08-04 · **Alcance:** 100% del repositorio (53 archivos) · **Método:** revisión línea a línea + explotación real contra instancia con PostgreSQL.

> **Todos los hallazgos marcados 💥 fueron reproducidos ejecutando código contra la aplicación**, no inferidos. Las evidencias son salida literal de los PoC.

---

## Veredicto ejecutivo

| Dimensión | Puntaje | Comentario |
|---|---:|---|
| **Seguridad** | **41**/100 | 2 escaladas de privilegio verticales verificadas. Base criptográfica correcta, capa de autorización rota. |
| **Arquitectura** | 78/100 | Separación limpia y direccionalidad de dependencias correcta. Sin capa de repositorio ni puertos/adaptadores. |
| **Escalabilidad** | **32**/100 | Techo real ~5.000 usuarios. Rate limit en memoria, sin caché, búsqueda con Seq Scan, DoS de 16 req/s. |
| **Mantenibilidad** | 71/100 | Legible y consistente; sin linter, sin tests reales, código muerto. |
| **Rendimiento** | **38**/100 | ~4 round-trips a BD por request autenticada; scrypt bloqueando el threadpool. |
| **Calidad de código** | 64/100 | El propio CLAUDE.md se incumple en 3 puntos. |
| **APIs** | 58/100 | Contrato sólido y consistente; sin OpenAPI, sin idempotencia, sin versionado real. |
| **Base de datos** | 55/100 | Modelo normalizado y con FK; 0 CHECK, email case-sensitive, sin purga, sin índices de búsqueda. |
| **DevOps** | **12**/100 | Cero: sin Dockerfile, CI, IaC, escaneo de dependencias ni observabilidad. |
| **GLOBAL** | **48**/100 | 🔴 **NO APTO PARA PRODUCCIÓN** |

**Bloqueantes absolutos:** C-01, C-02, C-03, C-04, C-05. Ninguno debe llegar a un entorno con datos reales.

---

## Tabla completa de hallazgos

| ID | Severidad | Hallazgo | Archivo | Verificado |
|---|---|---|---|---|
| C-01 | 🔴 Crítico | Escalada vertical vía `users:assign-roles` → superadmin | `users.service.ts:130` | 💥 |
| C-02 | 🔴 Crítico | Escalada vertical vía `roles:assign-permissions` → comodín `*` | `roles.service.ts:139` | 💥 |
| C-03 | 🔴 Crítico | DoS con 16 req/s: scrypt bloquea el threadpool de libuv | `password.ts:24` | 💥 |
| C-04 | 🔴 Crítico | Secreto JWT de ejemplo pasa la validación de producción | `env.ts:35`, `.env.example` | 💥 |
| C-05 | 🔴 Crítico | Refresh concurrente deja **0 sesiones**: cierre masivo de sesión | `auth.service.ts:210` | 💥 |
| C-06 | 🔴 Crítico | Búsqueda de usuarios = `Seq Scan` sobre toda la tabla | `users.service.ts:38` | 💥 |
| C-07 | 🔴 Crítico | CVE alto en `nodemailer@6.10.1` (SSRF + DoS) | `package.json` | 💥 |
| A-01 | 🟠 Alto | Mass assignment: usuario altera su propio `status` | `users.schemas.ts:38` | 💥 |
| A-02 | 🟠 Alto | Rate limit en memoria: inútil con >1 instancia | `rate-limit.ts:8` | ✓ |
| A-03 | 🟠 Alto | `/health` consume el presupuesto de rate limit → reinicio en bucle en K8s | `app.ts:52` | 💥 |
| A-04 | 🟠 Alto | Soft-delete veta de por vida al usuario social | `users.service.ts:108` | 💥 |
| A-05 | 🟠 Alto | ~4 round-trips a BD por request autenticada | `authenticate.ts:39` | 💥 |
| A-06 | 🟠 Alto | `sessions`/`verification_tokens` sin purga: 50% basura | `schema.prisma` | 💥 |
| A-07 | 🟠 Alto | Tokens OAuth del proveedor en claro y sin uso | `schema.prisma:66` | ✓ |
| A-08 | 🟠 Alto | Email case-sensitive: `A@x.com` y `a@x.com` coexisten | `schema.prisma:29` | 💥 |
| A-09 | 🟠 Alto | `npm run db:seed` inejecutable en imagen de producción | `package.json:20` | ✓ |
| A-10 | 🟠 Alto | `SameSite=strict` rompe el refresh en despliegue multi-dominio | `auth.controller.ts:28` | ✓ |
| A-11 | 🟠 Alto | Cero infraestructura: sin Dockerfile, CI, IaC, escaneo | (ausentes) | ✓ |
| A-12 | 🟠 Alto | Sin MFA/2FA ni registro de auditoría | (ausentes) | ✓ |
| A-13 | 🟠 Alto | Paginación OFFSET: degrada linealmente con la profundidad | `users.service.ts:52` | ✓ |
| A-14 | 🟠 Alto | Sin pool configurado ni PgBouncer: agota `max_connections` | `.env.example` | ✓ |
| A-15 | 🟠 Alto | Sin timeouts HTTP: Slowloris y conexiones colgadas | `server.ts:13` | ✓ |
| M-01 | 🟡 Medio | Enumeración de cuentas por status code (401 vs 403 vs 409) | `auth.service.ts` | 💥 |
| M-02 | 🟡 Medio | Cuenta bloqueada revela si la contraseña es correcta | `auth.service.ts:151` | 💥 |
| M-03 | 🟡 Medio | `z.string().url()` acepta `javascript:` → XSS almacenado | `users.schemas.ts:40` | 💥 |
| M-04 | 🟡 Medio | Respuestas con JWT sin `Cache-Control: no-store` | `api-response.ts` | 💥 |
| M-05 | 🟡 Medio | `X-Request-Id` del cliente reflejado sin allowlist | `request-context.ts:11` | 💥 |
| M-06 | 🟡 Medio | El seed puede regalar superadmin a una cuenta preexistente | `seed.ts:60` | ✓ |
| M-07 | 🟡 Medio | El seed borra permisos personalizados de roles de sistema | `seed.ts:44` | ✓ |
| M-08 | 🟡 Medio | Errores de Prisma logueados con parámetros de consulta (PII) | `error-handler.ts:63` | ✓ |
| M-09 | 🟡 Medio | Sin OpenAPI/Swagger ni contrato publicable | (ausente) | ✓ |
| M-10 | 🟡 Medio | Sin idempotencia en POST | (ausente) | ✓ |
| M-11 | 🟡 Medio | `npm run lint` roto: eslint no está declarado | `package.json:15` | 💥 |
| M-12 | 🟡 Medio | Sin tests unitarios/integración reales ni cobertura | (ausente) | ✓ |
| M-13 | 🟡 Medio | 0 constraints CHECK en la base de datos | `schema.prisma` | 💥 |
| M-14 | 🟡 Medio | `trust proxy: 1` fijo: falso con CDN + LB encadenados | `app.ts:26` | ✓ |
| M-15 | 🟡 Medio | Sin PKCE en el flujo OAuth | `google.ts` | ✓ |
| M-16 | 🟡 Medio | 10 dependencias desactualizadas (Zod 3→4, Prisma 6→7) | `package.json` | 💥 |
| B-01 | 🟢 Bajo | `as never` viola el §11 del propio CLAUDE.md | `users/roles.controller.ts:7` | 💥 |
| B-02 | 🟢 Bajo | Código muerto: 4 exports sin consumidor (viola §12) | `authenticate/authorize.ts` | 💥 |
| B-03 | 🟢 Bajo | `self-check.ts` se publica en la imagen de producción | `dist/` | 💥 |
| B-04 | 🟢 Bajo | Query extra innecesaria en `issueSession` | `auth.service.ts:216` | ✓ |
| B-05 | 🟢 Bajo | `bool` de env rechaza `1`/`True`/`yes` | `env.ts:18` | ✓ |
| B-06 | 🟢 Bajo | `urlencoded({extended:true})` innecesario en API JSON | `app.ts:48` | ✓ |
| B-07 | 🟢 Bajo | `compression()` sobre respuestas con secretos (BREACH) | `app.ts:45` | ✓ |
| B-08 | 🟢 Bajo | Sin `.nvmrc`, `.editorconfig`, `LICENSE`, `CHANGELOG` | (ausentes) | ✓ |

**Total: 45 hallazgos** — 7 críticos, 15 altos, 16 medios, 8 bajos. **21 reproducidos ejecutando código.**

---

# 🔴 CRÍTICOS

## C-01 — Escalada vertical: `users:assign-roles` concede superadmin

**Ubicación:** [users.service.ts:130](src/modules/users/users.service.ts#L130) · **Afecta:** `users.service.ts`, `users.routes.ts`, `authorize.ts`

### Por qué existe
`setRoles` resuelve los nombres de rol y los escribe. **No compara los privilegios del rol concedido con los del actor, ni impide que el actor se modifique a sí mismo.** El middleware `requirePermissions` responde a "¿puede asignar roles?" pero nunca a "¿puede asignar *este* rol?".

```ts
// users.service.ts — el código actual, sin ninguna barrera
export async function setRoles(id: string, roleNames: string[], actorId: string) {
  const roleIds = await resolveRoleIds(roleNames);   // solo valida que existan
  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: id } }),
    prisma.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId, assignedBy: actorId })) }),
  ]);
}
```

### Cómo explotarlo — **verificado**

```
Atacante: rol "gestor-usuarios", permisos = ["users:assign-roles","users:read"]

1) GET  /api/v1/roles                       -> 403 INSUFFICIENT_PERMISSIONS
2) DELETE /api/v1/users/<id>                -> 403 INSUFFICIENT_PERMISSIONS

3) PUT /api/v1/users/<SU-PROPIO-ID>/roles
   {"roles":["gestor-usuarios","superadmin"]}   -> 200 OK  💥
   roles ahora = ["superadmin","gestor-usuarios"]
   permisos tras re-login = ["*","users:assign-roles","users:read"]

4) GET /api/v1/roles                        -> 200  ⇦ ESCALADA COMPLETA
5) DELETE /api/v1/roles/<id>                -> autorizado
```

Una sola petición HTTP convierte al perfil delegado más común de cualquier empresa (RRHH, soporte, onboarding) en dueño absoluto del sistema.

### Riesgo e impacto
**CWE-269 (Improper Privilege Management), OWASP API1:2023 BOLA + API5:2023 BFLA, ASVS 4.0 §4.1.3.** Compromiso total: lectura y borrado de todos los usuarios, alteración del RBAC, persistencia. CVSS 3.1 ≈ **8.8 (Alto)**, y **9.9** si el rol delegado se concede a usuarios externos.

### Corrección

```ts
// core/rbac/guards.ts  (nuevo)
import { prisma } from '../db/prisma';
import { AppError } from '../http/errors';
import { WILDCARD_PERMISSION } from './permissions';

/**
 * Regla de no-escalada: nadie puede conceder autoridad que no posee.
 * Es el invariante central del RBAC; sin él, delegar es regalar el sistema.
 */
export async function assertPuedeConcederRoles(
  actor: { id: string; permissions: Set<string> },
  targetUserId: string,
  roleNames: string[],
): Promise<void> {
  const esSuperadmin = actor.permissions.has(WILDCARD_PERMISSION);

  // 1. Nadie edita sus propios roles. Ni el superadmin: obliga a 4-eyes.
  if (actor.id === targetUserId) {
    throw AppError.forbidden('No puedes modificar tus propios roles.');
  }

  if (esSuperadmin) return;

  // 2. El conjunto de permisos concedido debe ser subconjunto del propio.
  const roles = await prisma.role.findMany({
    where: { name: { in: roleNames } },
    select: { name: true, permissions: { select: { permission: { select: { action: true } } } } },
  });

  const excedidos = new Set<string>();
  for (const rol of roles) {
    for (const { permission } of rol.permissions) {
      if (!actor.permissions.has(permission.action)) excedidos.add(permission.action);
    }
  }

  if (excedidos.size > 0) {
    throw AppError.forbidden(
      `No puedes conceder permisos que no posees: ${[...excedidos].sort().join(', ')}.`,
    );
  }
}
```

```ts
// users.service.ts
export async function setRoles(id: string, roleNames: string[], actor: AuthenticatedUser) {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!user) throw AppError.notFound('Usuario');

  await assertPuedeConcederRoles(actor, id, roleNames);      // ⇦ el invariante
  const roleIds = await resolveRoleIds(roleNames);

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: id } }),
    prisma.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId, assignedBy: actor.id })) }),
    prisma.auditLog.create({ data: { actorId: actor.id, action: 'user.roles.set', targetId: id, metadata: { roles: roleNames } } }),
    // Los roles cambiaron: las sesiones del afectado deben re-evaluarse.
    prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  return getById(id);
}
```

### Buenas prácticas
AWS IAM lo resuelve con `iam:PermissionsBoundary`; GCP exige `roles/iam.securityAdmin` como permiso *separado* de la administración de usuarios; Kubernetes RBAC implementa exactamente esta regla bajo el nombre **privilege escalation prevention** (`escalate` verb). El principio: *conceder autoridad es una operación distinta —y más privilegiada— que administrar usuarios*.

**Prioridad: P0 — bloquea el despliegue.**

---

## C-02 — Escalada vertical: `roles:assign-permissions` concede el comodín `*`

**Ubicación:** [roles.service.ts:139](src/modules/roles/roles.service.ts#L139)

### Por qué existe
`setPermissions` acepta cualquier `action` del catálogo, **incluido `*`**, y no verifica que el actor lo posea ni que el rol destino sea uno de los suyos.

### Cómo explotarlo — **verificado**

```
Atacante: rol "gestor-permisos", permisos = ["roles:assign-permissions"]

PUT /api/v1/roles/<SU-PROPIO-ROL>/permissions {"permissions":["*"]}  -> 200 OK 💥
permisos tras re-login = ["*"]   ⇦ COMODÍN OBTENIDO
```

### Riesgo e impacto
Idéntico a C-01 pero **más grave**: `*` es un comodín global que pasa cualquier control futuro, incluido código que aún no existe. Cualquier módulo nuevo nace comprometido.

### Corrección

```ts
// roles.service.ts
export async function setPermissions(id: string, actions: string[], actor: AuthenticatedUser) {
  const role = await getSystemRole(id);

  // 1. El comodín no se concede por API. Solo por seed, con acceso al servidor.
  if (actions.includes(WILDCARD_PERMISSION)) {
    throw AppError.forbidden('El permiso comodín "*" solo puede asignarse desde el seed.');
  }

  // 2. Los roles de sistema no cambian de permisos por API: son el contrato del código.
  if (role.isSystem) {
    throw AppError.forbidden('Los permisos de un rol de sistema se definen en core/rbac/permissions.ts.');
  }

  // 3. No-escalada: nadie concede lo que no tiene.
  if (!actor.permissions.has(WILDCARD_PERMISSION)) {
    const excedidos = actions.filter((a) => !actor.permissions.has(a));
    if (excedidos.length > 0) {
      throw AppError.forbidden(`No puedes conceder permisos que no posees: ${excedidos.join(', ')}.`);
    }
    // 4. Y no modifica un rol que él mismo ostenta (auto-elevación indirecta).
    if (actor.roles.includes(role.name)) {
      throw AppError.forbidden('No puedes modificar los permisos de un rol que tú posees.');
    }
  }

  const permissionIds = await resolvePermissionIds(actions);
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: id } }),
    prisma.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })) }),
    prisma.auditLog.create({ data: { actorId: actor.id, action: 'role.permissions.set', targetId: id, metadata: { permissions: actions } } }),
  ]);
  return getById(id);
}
```

**Alternativa de diseño (recomendada a medio plazo):** eliminar el comodín `*` del modelo y sustituirlo por expansión explícita en el seed. Un comodín es un *bypass* del sistema de autorización, y todo bypass acaba siendo la vía de ataque.

| | Comodín `*` | Expansión explícita |
|---|---|---|
| Ventaja | El superadmin nunca se queda sin permiso nuevo | Auditable: se ve exactamente qué puede cada rol |
| Desventaja | Un solo string concede todo, presente y futuro | Hay que re-sembrar al añadir permisos (ya se hace) |

**Prioridad: P0.**

---

## C-03 — DoS con 16 req/s: scrypt bloquea el threadpool de libuv

**Ubicación:** [password.ts:24](src/core/security/password.ts#L24)

### Por qué existe
Los parámetros `N=2^16, r=8, p=1` cuestan **64 MB y 80 ms por hash**. `crypto.scrypt` es asíncrono pero se ejecuta en el **threadpool de libuv, que por defecto tiene 4 hilos** y es **compartido con `fs`, `dns` y `zlib`**. Saturarlo no degrada el login: **congela el proceso entero**.

### Cómo explotarlo — **medido**

```
1 hash scrypt                        =  81 ms   (64 MB de RAM)
16 hashes concurrentes               = 343 ms   (4.2x — solo hay 4 hilos)
fs.readFile trivial durante el flood = 331 ms   (normalmente <1 ms)  💥

Pico de RAM sostenido: 16 × 64 MB = 1.0 GB
```

Un atacante que envíe **16 POST /auth/login por segundo con correos inexistentes** (la ruta ejecuta scrypt igual, por diseño anti-enumeración) paraliza la instancia. Coste: una conexión doméstica. El `authRateLimit` no salva: es **por IP y en memoria** (A-02), así que 16 IPs bastan; y `skipSuccessfulRequests: true` deja pasar ilimitados logins válidos.

### Riesgo e impacto
**CWE-400 (Uncontrolled Resource Consumption), OWASP API4:2023.** Denegación de servicio total con recursos despreciables. La resolución DNS de Prisma también viaja por ese threadpool: **la aplicación pierde la base de datos** bajo el ataque.

### Corrección

**1. Subir el threadpool y acotar la concurrencia de hashing:**

```ts
// server.ts — antes de cualquier import que use crypto
process.env.UV_THREADPOOL_SIZE ??= String(Math.max(8, os.cpus().length * 2));
```

```ts
// core/security/password.ts
import { AppError } from '../http/errors';

// Semáforo: nunca más de N hashes en vuelo. El exceso recibe 503, no cuelga el proceso.
const MAX_EN_VUELO = Number(process.env.PASSWORD_HASH_CONCURRENCY ?? 4);
let enVuelo = 0;

async function conLimite<T>(fn: () => Promise<T>): Promise<T> {
  if (enVuelo >= MAX_EN_VUELO) {
    throw new AppError(503, ErrorCode.RATE_LIMITED, 'Servicio de autenticación saturado. Reintenta en unos segundos.');
  }
  enVuelo++;
  try { return await fn(); } finally { enVuelo--; }
}

// Parámetros calibrados: OWASP admite N=2^15 con r=8,p=3 (mismo coste, 32MB en vez de 64MB).
const PARAMS = { N: 2 ** 15, r: 8, p: 3, maxmem: 128 * 2 ** 15 * 8 * 4 };
```

**2. Prueba de trabajo antes del hash** (patrón de Cloudflare Turnstile / hCaptcha): exigir un token de desafío en `/auth/login` tras el segundo fallo desde una IP.

**3. Descartar temprano**: aplicar el rate limit **distribuido** (A-02) *antes* de llegar a scrypt.

> **Nota sobre la simplificación original.** El comentario `// ponytail: scrypt es stdlib` justificaba evitar una dependencia nativa. La decisión es defendible criptográficamente, pero **el techo no era el que declaraba el comentario**: no es "migrar a argon2 si una auditoría lo exige", es que los parámetros elegidos, sin semáforo y con el threadpool por defecto, son un vector de DoS. El atajo estaba mal calibrado, no mal elegido.

**Alternativa:** mover el hashing a un `worker_thread` dedicado o a un microservicio de autenticación. Es lo que hacen Auth0 y Okta —el hashing nunca comparte proceso con el tráfico de API.

**Prioridad: P0.**

---

## C-04 — El secreto JWT de ejemplo supera la validación de producción

**Ubicación:** [env.ts:35](src/config/env.ts#L35), [.env.example](.env.example)

### Por qué existe
El esquema solo exige `min(32)`. El placeholder `cambia-esto-por-un-secreto-largo-y-aleatorio-32chars` tiene **52 caracteres** → **pasa la validación**. Está publicado en el repositorio.

### Cómo explotarlo — **verificado**

```
"cambia-esto-por-un-secreto-l..." = 52 chars -> z.string().min(32) ✓ PASA 💥
```

Un despliegue que copie `.env.example` sin editar arranca sin un solo aviso y firma todos los JWT con un secreto **público en Git**. El atacante forja un access token con cualquier `sub` y `sid`... aunque el `sid` debe existir en `sessions`, basta registrarse para obtener uno propio y luego cambiar el `sub` al de la víctima. **Suplantación total de identidad.**

### Riesgo e impacto
**CWE-798 (Hardcoded Credentials), OWASP A02:2021 + A07:2021, ASVS §2.10.4.** Suplantación de cualquier usuario, incluido el superadmin. CVSS **9.8 (Crítico)**.

### Corrección

```ts
// config/env.ts
const SECRETOS_PROHIBIDOS = [
  'cambia-esto-por-un-secreto-largo-y-aleatorio-32chars',
  'cambia-esto-por-otro-secreto-distinto-y-aleatorio',
  'secret', 'changeme', 'default', 'test',
];

/** Entropía mínima: un secreto de 48 chars repetidos no es un secreto. */
function entropiaSuficiente(s: string): boolean {
  return new Set(s).size >= 16;
}

.superRefine((v, ctx) => {
  for (const clave of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const valor = v[clave];
    if (SECRETOS_PROHIBIDOS.some((p) => valor.includes(p))) {
      ctx.addIssue({ code: 'custom', path: [clave],
        message: 'Es el valor de ejemplo del repositorio. Genera uno: openssl rand -base64 48' });
    }
    if (v.NODE_ENV === 'production') {
      if (valor.length < 48) ctx.addIssue({ code: 'custom', path: [clave], message: 'Mínimo 48 caracteres en producción.' });
      if (!entropiaSuficiente(valor)) ctx.addIssue({ code: 'custom', path: [clave], message: 'Entropía insuficiente.' });
    }
  }
  if (v.NODE_ENV === 'production' && v.SEED_ADMIN_PASSWORD === 'Admin123!Cambiar') {
    ctx.addIssue({ code: 'custom', path: ['SEED_ADMIN_PASSWORD'], message: 'Es la contraseña de ejemplo.' });
  }
});
```

Y en `.env.example`, dejar los valores **vacíos** en lugar de rellenos: un campo vacío falla ruidosamente; un placeholder válido falla en silencio.

### Buenas prácticas
Stripe y GitHub prefijan sus claves (`sk_live_`, `ghp_`) precisamente para poder detectarlas con escáneres. Lo estándar en Enterprise es **no tener secretos en `.env`**: AWS Secrets Manager / HashiCorp Vault / GCP Secret Manager con rotación automática, más `gitleaks` en pre-commit y CI.

**Prioridad: P0.**

---

## C-05 — Refresh concurrente deja al usuario con **0 sesiones**

**Ubicación:** [auth.service.ts:210](src/modules/auth/auth.service.ts#L210)

### Por qué existe
La secuencia leer → crear → revocar **no es atómica ni está serializada**:

```ts
const session = await prisma.session.findUnique({ where: { tokenHash } });  // (1) lee
if (session.revokedAt) { /* revoca TODAS las sesiones */ }
const tokens = await issueSession(user.id, meta);                            // (2) crea
await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } }); // (3) revoca
```

Entre (1) y (3) hay una ventana en la que otra petición con el mismo token lee `revokedAt: null` y pasa. Peor: si una petición llega **después** de (3), dispara la detección de robo y **revoca todas las sesiones del usuario, incluida la recién creada**.

### Cómo explotarlo — **verificado**

```
3 refresh simultáneos con el MISMO token -> [200, 401, 401]
sesiones vivas resultantes = 0            ⇦ 💥 el 200 se auto-anuló
```

No hace falta un atacante. Lo dispara solo:
- dos pestañas del navegador refrescando a la vez,
- un reintento automático tras un timeout de red,
- una app móvil que recupera conectividad,
- cualquier cliente con `retry` en su cliente HTTP.

El usuario legítimo queda **desconectado de todos sus dispositivos** de forma aleatoria.

### Riesgo e impacto
**CWE-362 (Race Condition), OWASP A04:2021.** No es solo disponibilidad: es un **falso positivo del sistema de detección de robo**, que erosiona la confianza en la única señal de compromiso que tiene el sistema. En producción se traduce en oleadas de tickets de soporte y en que el equipo acabe desactivando la detección —perdiendo la protección real.

### Corrección

Rotación atómica con **actualización condicional** (compare-and-swap): la propia base de datos decide el ganador.

```ts
export async function refresh(refreshToken: string, meta: RequestMeta): Promise<AuthResult> {
  const tokenHash = hashToken(refreshToken);

  return prisma.$transaction(async (tx) => {
    // CAS: solo una petición consigue marcar revokedAt. `count` es el árbitro.
    const { count } = await tx.session.updateMany({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });

    const session = await tx.session.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, replacedById: true, createdAt: true },
    });
    if (!session) throw AppError.unauthorized('Sesión inválida.', ErrorCode.TOKEN_INVALID);

    if (count === 0) {
      // Perdió la carrera. ¿Reintento benigno o reuso malicioso?
      // Ventana de gracia: rotaciones dentro de N segundos son concurrencia normal.
      const GRACIA_MS = 15_000;
      const rotadoHaceNada = session.replacedById &&
        Date.now() - session.createdAt.getTime() < GRACIA_MS;

      if (!rotadoHaceNada) {
        await tx.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
        logger.warn({ userId: session.userId }, 'Reuso de refresh token: sesiones revocadas');
        throw AppError.unauthorized('Se detectó un uso indebido de la sesión.', ErrorCode.TOKEN_INVALID);
      }
      throw AppError.unauthorized('Rotación concurrente; reintenta.', ErrorCode.TOKEN_EXPIRED);
    }

    const user = await tx.user.findFirst({ where: { id: session.userId, deletedAt: null }, select: { id: true, status: true, lockedUntil: true } });
    if (!user) throw AppError.unauthorized('Sesión inválida.', ErrorCode.TOKEN_INVALID);
    assertUsable(user);

    // Crear la nueva sesión DENTRO de la misma transacción, y enlazarla.
    const nuevoToken = generateOpaqueToken();
    const nueva = await tx.session.create({
      data: {
        userId: user.id, tokenHash: hashToken(nuevoToken),
        expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * MS_PER_DAY),
        ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 255) ?? null,
      },
      select: { id: true, user: { select: { email: true } } },
    });
    await tx.session.update({ where: { id: session.id }, data: { replacedById: nueva.id } });

    return {
      user: await loadPublicUser(user.id),
      tokens: {
        accessToken: signAccessToken({ sub: user.id, email: nueva.user.email, sid: nueva.id }),
        refreshToken: nuevoToken, expiresIn: env.JWT_ACCESS_TTL, tokenType: 'Bearer' as const,
      },
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
```

Esto además elimina **B-04** (la query extra `findUniqueOrThrow` por `tokenHash` que solo servía para recuperar un id que `create` ya devolvía).

### Buenas prácticas
Es el modelo del **RFC 6819 §5.2.2.3** y el que implementan Auth0 (*refresh token rotation with reuse detection* + *leeway* configurable) y Okta. La **ventana de gracia** no es una concesión: es lo que separa un sistema de detección usable de uno que el equipo acaba apagando.

**Prioridad: P0.**

---

## C-06 — La búsqueda de usuarios recorre la tabla entera

**Ubicación:** [users.service.ts:38](src/modules/users/users.service.ts#L38)

### Por qué existe
`contains` + `mode: 'insensitive'` genera `ILIKE '%término%'`. Un comodín a la izquierda **inhabilita cualquier B-tree**.

### Evidencia — **plan real de PostgreSQL**

```sql
EXPLAIN SELECT * FROM users WHERE email ILIKE '%ana%' LIMIT 20;

Limit  (cost=0.00..13.88 rows=12 width=232)
  ->  Seq Scan on users        ⇦ 💥 lectura secuencial completa
        Filter: (email ~~* '%ana%'::text)
```

Con 10 M de usuarios: ~4 GB leídos por búsqueda. Y el `count(*)` que acompaña a la paginación repite el escaneo. **Dos escaneos completos por petición.** Diez usuarios buscando a la vez tumban la base de datos.

### Corrección

```sql
-- migración: búsqueda por trigramas
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY users_busqueda_trgm_idx
  ON users USING GIN ((coalesce(email,'') || ' ' || coalesce("firstName",'') || ' ' || coalesce("lastName",'')) gin_trgm_ops);

-- email case-insensitive con índice funcional (resuelve también A-08)
CREATE UNIQUE INDEX CONCURRENTLY users_email_lower_key ON users (lower(email)) WHERE "deletedAt" IS NULL;
```

```ts
// users.service.ts — búsqueda por trigramas + conteo aproximado
export async function list(query: ListUsersQuery): Promise<ListResult> {
  if (query.search) {
    const term = `%${query.search}%`;
    const items = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
      WHERE "deletedAt" IS NULL
        AND (coalesce(email,'') || ' ' || coalesce("firstName",'') || ' ' || coalesce("lastName",'')) ILIKE ${term}
      ORDER BY "createdAt" DESC
      LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`;
    // ...hidratar con findMany({ where: { id: { in: ids } } })
  }
  // ...
}
```

**Conteo:** para tablas grandes, sustituir `count()` exacto por `reltuples` de `pg_class` cuando no hay filtro, o devolver `hasNext` en lugar de `total` (pedir `limit + 1` filas). Google, GitHub y Slack **no muestran el total** en listas grandes exactamente por esto.

**Prioridad: P0 a partir de ~100.000 usuarios; P1 antes.**

---

## C-07 — CVE alto en `nodemailer@6.10.1`

**Ubicación:** [package.json:35](package.json#L35)

### Evidencia — `npm audit`

```
nodemailer  high  (instalado: 6.10.1)
  · GHSA-p6gq-j5cr-w38f  HIGH  CVSS 7.1 — raw option bypasses disableFileAccess/disableUrlAccess
                                → lectura arbitraria de ficheros + SSRF completo
  · GHSA-rcmh-qjqh-p98v  HIGH  CVSS 7.5 — DoS por recursión en addressparser (<=7.0.10)
  · +6 avisos moderate (inyección CRLF en cabeceras, TLS sin validar en OAuth2)
```

**Explotación:** `addressparser` procesa direcciones de correo. Toda dirección que entre por `/auth/register` o `/auth/forgot-password` llega al parser → **DoS remoto no autenticado** con un correo malformado.

### Corrección

```bash
npm i nodemailer@^9   # incluye el fix de GHSA-p6gq-j5cr-w38f
npm i -D @types/nodemailer@^8
npm audit --audit-level=high   # debe salir limpio
```

Añadir al CI (ver A-11) `npm audit --audit-level=high` como *gate* que rompe el build, más Dependabot/Renovate. **Prioridad: P0.**

---

# 🟠 ALTOS

## A-01 — Mass assignment: el usuario altera su propio `status`

**Ubicación:** [users.schemas.ts:38](src/modules/users/users.schemas.ts#L38), [users.routes.ts:22](src/modules/users/users.routes.ts#L22)

`PATCH /users/me` reutiliza `updateUserSchema`, que incluye `status` —un campo administrativo.

**Verificado:**
```
PATCH /api/v1/users/me {"firstName":"X","status":"SUSPENDED"} -> 200 OK, status=SUSPENDED 💥
```

**Riesgo:** CWE-915, OWASP API3:2023. Hoy el impacto es auto-DoS. Mañana, en cuanto alguien añada `isPremium`, `credits`, `tenantId` o `emailVerified` a ese schema, es escalada directa. El fallo no es el campo: **es el patrón de compartir schema entre `/me` y `/:id`**.

**Corrección:**
```ts
// users.schemas.ts — schemas separados por nivel de autoridad. Nunca reutilizar.
const perfilEditable = { firstName: ..., lastName: ..., avatarUrl: ... };

/** Lo que un usuario puede cambiar de SÍ MISMO. */
export const updateMeSchema = z.object(perfilEditable).partial()
  .strict()                                      // rechaza campos desconocidos en vez de descartarlos
  .refine((v) => Object.keys(v).length > 0, { message: 'Envía al menos un campo.' });

/** Lo que un ADMINISTRADOR puede cambiar de otro. */
export const updateUserSchema = z.object({ ...perfilEditable, status: z.nativeEnum(UserStatus) })
  .partial().strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Envía al menos un campo.' });
```
```ts
router.patch('/me', validate({ body: updateMeSchema }), controller.updateMe);
```

`.strict()` convierte el descarte silencioso de Zod en un 422 explícito: el cliente se entera de que envió algo que no debía.

**Prioridad: P1.**

---

## A-02 — Rate limit en memoria: inútil con más de una instancia

**Ubicación:** [rate-limit.ts:8](src/core/middleware/rate-limit.ts#L8)

El store por defecto de `express-rate-limit` es un `Map` en el proceso. Con N réplicas el límite efectivo es **N × el configurado**, y cada despliegue lo resetea. Con 10 pods, `AUTH_RATE_LIMIT_MAX=10` significa 100 intentos —y es exactamente la defensa de la que depende C-03.

**Corrección:**
```ts
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../cache/redis';

const base: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args: string[]) => redis.sendCommand(args) }),
  keyGenerator: (req) => req.ip ?? req.socket.remoteAddress ?? 'sin-ip',
};

/** El login se limita por IP **y** por cuenta: frena el password spraying. */
export const authRateLimit = rateLimit({
  ...base,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`,
  // OJO: skipSuccessfulRequests:true permitía logins válidos ilimitados. Se retira.
});
```

**Buenas prácticas:** Cloudflare y Stripe aplican límites en **tres ejes** —IP, cuenta y clave de API— con *token bucket* distribuido. El límite por IP solo, en la era de las botnets residenciales, es decorativo. **Prioridad: P1.**

---

## A-03 — `/health` consume el rate limit: reinicio en bucle en Kubernetes

**Ubicación:** [app.ts:52](src/app.ts#L52)

`app.use(env.API_PREFIX, globalRateLimit)` se monta antes de las rutas, y `health` cuelga del mismo prefijo.

**Verificado:**
```
130 probes a /api/v1/health -> 19 respondieron 429 (el primero en la #112) 💥
```

En Kubernetes todas las probes llegan desde la **misma IP del nodo/kubelet**. Un `livenessProbe` que reciba 429 marca el pod como muerto y lo reinicia. Bajo carga —justo cuando el rate limit se activa— **el clúster entra en CrashLoopBackOff**: el mecanismo de protección se convierte en la causa de la caída.

**Corrección:**
```ts
// app.ts — health se monta ANTES del rate limit y queda fuera de él
import healthRouter from './modules/health/health.routes';
app.use(`${env.API_PREFIX}/health`, healthRouter);   // sin límite

app.use(env.API_PREFIX, globalRateLimit);            // el resto sí

const routes = await loadRoutes(app, { modulesDir: ..., prefix: env.API_PREFIX, exclude: ['health'] });
```
o, sin romper el autoload:
```ts
export const globalRateLimit = rateLimit({
  ...base,
  skip: (req) => req.path.startsWith('/health') || req.path === '/metrics',
});
```

**Prioridad: P1 — es un incidente de producción garantizado, no una hipótesis.**

---

## A-04 — El borrado lógico veta de por vida al usuario social

**Ubicación:** [users.service.ts:108](src/modules/users/users.service.ts#L108)

`remove()` anonimiza el email y marca `deletedAt`, pero **no toca la tabla `accounts`**. La fila `(provider, providerAccountId)` sobrevive apuntando al usuario borrado.

**Verificado:**
```
La fila Account sigue apuntando al userId borrado 💥
loginWithOAuth la encuentra -> filtra deletedAt -> 401 "La cuenta ya no existe"
Ese Google UID no puede volver a registrarse JAMÁS.
```

El `@@unique([provider, providerAccountId])` impide crear una cuenta nueva, y la búsqueda por email tampoco ayuda porque el email original fue destruido. **El usuario queda permanentemente excluido del servicio sin forma de recuperarse.**

**Corrección:**
```ts
export async function remove(id: string, actorId: string): Promise<void> {
  if (id === actorId) throw AppError.badRequest('No puedes eliminar tu propia cuenta.');
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true, email: true } });
  if (!user) throw AppError.notFound('Usuario');

  await prisma.$transaction([
    // El email original se conserva cifrado para soporte/legal; se libera el UNIQUE.
    prisma.user.update({
      where: { id },
      data: { status: UserStatus.DELETED, deletedAt: new Date(),
              email: `deleted+${id}@invalid.local`, emailAnterior: cifrar(user.email) },
    }),
    // Se desvinculan los proveedores: el usuario puede volver a registrarse.
    prisma.account.deleteMany({ where: { userId: id } }),
    prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.verificationToken.deleteMany({ where: { userId: id } }),
    prisma.auditLog.create({ data: { actorId, action: 'user.delete', targetId: id } }),
  ]);
}
```

**Nota RGPD:** el "derecho al olvido" (art. 17) exige poder borrar de verdad, no solo marcar. Hace falta un job de *hard delete* a los 30 días y una política de retención documentada. **Prioridad: P1.**

---

## A-05 — ~4 round-trips a base de datos por request autenticada

**Ubicación:** [authenticate.ts:39](src/core/middleware/authenticate.ts#L39)

`authenticate` ejecuta: (1) `findFirst` sobre `sessions`, (2) `findFirst` sobre `users` con `select` anidado que Prisma resuelve como (3) consulta a `user_roles`+`roles` y (4) consulta a `role_permissions`+`permissions`.

**Verificado:** 30 peticiones a `/auth/me` en 3 ms *en local con la BD en el mismo host*. Con 2 ms de RTT de red —lo normal entre pods y RDS— son **8 ms de latencia añadida a cada request** y **4× la carga de conexiones**. A 10.000 req/s son **40.000 consultas/s** solo para autenticar.

El comentario `// ponytail: una query por request` **subestimaba el coste**: no es una consulta, son cuatro.

**Corrección — dos niveles:**

```ts
// 1. Colapsar a UNA consulta con relationJoins (Prisma 5.10+)
generator client { previewFeatures = ["relationJoins"] }
```

```ts
// 2. Caché de permisos en Redis con invalidación por versión.
//    La versión se incrementa al tocar roles/permisos: invalidación O(1) sin escanear claves.
const CACHE_TTL = 300;

async function loadUser(userId: string, sessionId: string): Promise<AuthenticatedUser> {
  const version = await redis.get(`rbac:version:${userId}`) ?? '0';
  const clave = `rbac:user:${userId}:v${version}`;

  const cacheado = await redis.get(clave);
  if (cacheado) {
    const d = JSON.parse(cacheado);
    return { ...d, sessionId, permissions: new Set<string>(d.permissions) };
  }
  const fresco = await consultarUsuarioConRoles(userId);
  await redis.setEx(clave, CACHE_TTL, JSON.stringify({ ...fresco, permissions: [...fresco.permissions] }));
  return { ...fresco, sessionId };
}

/** Se llama desde setRoles / setPermissions / suspensión. */
export async function invalidarRbac(userId: string): Promise<void> {
  await redis.incr(`rbac:version:${userId}`);
}
```

La validez de la sesión sigue en BD (o en Redis con el mismo TTL), preservando la revocación inmediata que era el motivo original del diseño.

**Prioridad: P1 por encima de ~1.000 req/s.**

---

## A-06 — `sessions` y `verification_tokens` crecen sin límite

**Verificado:** tras 6 ciclos de login+logout, **7 de 14 filas (50%) son basura permanente**. No existe ningún job de purga en el proyecto.

Con 1 M de usuarios activos × 1 sesión/día × 30 días de TTL: **30 M de filas**, la mayoría revocadas. El índice `sessions_tokenHash_key` crece con ellas; el *autovacuum* no borra filas vivas y `expiresAt` no caduca nada por sí solo.

**Corrección:**
```sql
-- Purga particionada e incremental (evita bloqueos largos)
DELETE FROM sessions
WHERE ctid IN (
  SELECT ctid FROM sessions
  WHERE ("expiresAt" < now() - interval '7 days')
     OR ("revokedAt" IS NOT NULL AND "revokedAt" < now() - interval '7 days')
  LIMIT 10000
);
```
```ts
// core/jobs/purga.ts — con node-cron o, mejor, un CronJob de Kubernetes
export async function purgarSesiones(): Promise<number> {
  let total = 0, borradas;
  do {
    borradas = await prisma.$executeRaw`DELETE FROM sessions WHERE ctid IN (...)`;
    total += borradas;
    await new Promise((r) => setTimeout(r, 100));   // cede E/S a la carga real
  } while (borradas === 10000);
  return total;
}
```

**A escala:** particionar `sessions` por rango de `expiresAt` y hacer `DROP PARTITION` —instantáneo frente a un `DELETE` masivo. Es lo que hacen Uber y Discord con sus tablas de eventos. **Prioridad: P1.**

---

## A-07 — Tokens del proveedor OAuth en claro (y sin usarse)

**Ubicación:** [schema.prisma:66](prisma/schema.prisma#L66)

`Account.accessToken` y `Account.refreshToken` guardan credenciales de Google en texto plano. **El código nunca los lee.** Un volcado de la BD entrega acceso a las APIs de Google de todos los usuarios (Gmail, Drive, Calendar según scopes).

Es además una violación de mi propia regla §12 del CLAUDE.md (*"nada de config para un valor que nunca cambia"* / YAGNI): se almacena un secreto **por si acaso**.

**Corrección — la laziest y la más segura coinciden: no guardarlos.**
```prisma
model Account {
  id String @id @default(uuid()) @db.Uuid
  userId String @db.Uuid
  provider String
  providerAccountId String
  email String?
  // accessToken/refreshToken eliminados: no se usan y son un pasivo de seguridad.
  // Si algún día hace falta llamar a la API del proveedor, cifrar con AES-256-GCM
  // y clave en KMS/Vault — nunca en la misma BD que el dato cifrado.
}
```
Si en el futuro se necesitan, el patrón correcto es *envelope encryption* (AWS KMS / GCP KMS) con la DEK cifrada junto al dato y la KEK fuera de la base. **Prioridad: P1.**

---

## A-08 — Email case-sensitive: cuentas duplicadas

**Verificado:**
```sql
INSERT INTO users VALUES ('Colision@Test.local'), ('colision@test.local');   -- INSERT 0 2 💥
SELECT count(*) FROM users WHERE lower(email)='colision@test.local';         -- 2
```

Zod normaliza a minúsculas en la capa de aplicación, pero **la base de datos no lo garantiza**: el seed (`SEED_ADMIN_EMAIL` sin normalizar), una migración de datos, un script de importación o cualquier acceso directo crean duplicados. Dos cuentas para la misma persona → confusión de sesión, verificaciones cruzadas, y `findFirst` devolviendo una u otra de forma no determinista.

**Corrección:** el índice funcional único de C-06 (`CREATE UNIQUE INDEX ... ON users (lower(email))`), o migrar la columna a `citext`. Preferible el índice funcional: `citext` tiene sorpresas con colaciones y con `LIKE`. **Prioridad: P1.**

---

## A-09 — `npm run db:seed` inejecutable en producción

`"db:seed": "tsx prisma/seed.ts"` y **`tsx` es una `devDependency`**. Una imagen construida con `npm ci --omit=dev` —lo correcto— no puede sembrar. El primer despliegue arranca **sin permisos, sin roles y sin superadmin**: nadie puede administrar nada.

Además `prisma/seed.ts` importa de `../src/...`, fuera del `rootDir`, así que `tsc` no lo compila a `dist/`.

**Corrección:**
```json
{
  "scripts": {
    "build": "prisma generate && tsc -p tsconfig.json && tsc -p tsconfig.seed.json",
    "db:seed": "node dist/prisma/seed.js",
    "db:seed:dev": "tsx prisma/seed.ts"
  }
}
```
```json
// tsconfig.seed.json
{ "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": ".", "outDir": "dist", "noEmit": false },
  "include": ["prisma/seed.ts", "src/config/**/*", "src/core/**/*"] }
```
**Prioridad: P1 — bloquea el primer despliegue.**

---

## A-10 — `SameSite=strict` rompe el refresh en despliegue multi-dominio

**Ubicación:** [auth.controller.ts:28](src/modules/auth/auth.controller.ts#L28)

`sameSite: isProd ? 'strict' : 'lax'`. Si el frontend vive en `app.empresa.com` y la API en `api.empresa.com` funciona (mismo dominio registrable). Pero si el frontend está en `empresa.com` y la API en `api-empresa.io` —o hay un dominio de cliente white-label— **el navegador no envía la cookie** y `/auth/refresh` falla siempre: sesiones de 15 minutos sin renovación posible.

Es peor porque **falla en producción y funciona en desarrollo** (`lax`): el clásico bug que no aparece hasta el despliegue.

**Corrección:**
```ts
// La política de cookies es una decisión de despliegue, no una constante de código.
COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('lax'),
```
```ts
sameSite: env.COOKIE_SAMESITE,
// 'none' EXIGE secure:true; validarlo en env.ts para que no falle en silencio.
```
```ts
// env.ts
if (v.COOKIE_SAMESITE === 'none' && !v.COOKIE_SECURE) {
  ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'SameSite=none exige Secure=true.' });
}
```
Con `SameSite=none` hay que **reponer la defensa CSRF** que `strict` daba gratis: token double-submit o cabecera `Origin` verificada en `/auth/refresh`. **Prioridad: P1.**

---

## A-11 — Cero infraestructura

**Verificado — ausentes:** `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.github/workflows/`, manifiestos K8s, `nginx.conf`, `eslint.config.js`, `.prettierrc`, `.nvmrc`, `openapi.yaml`, `LICENSE`, `.editorconfig`.

No hay build reproducible, ni CI, ni gate de calidad, ni escaneo de dependencias, ni definición de recursos, ni observabilidad. El proyecto **no es desplegable** por nadie que no reproduzca el entorno a mano.

**Corrección — mínimo viable:**

```dockerfile
# Dockerfile — multi-stage, non-root, distroless
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM gcr.io/distroless/nodejs22-debian12 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
USER 65532:65532
EXPOSE 3000
CMD ["dist/server.js"]
```

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  calidad:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: test }
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-retries 10
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npx prisma migrate deploy
      - run: npm test -- --coverage
      - run: npm audit --audit-level=high     # gate: rompe el build
      - uses: gitleaks/gitleaks-action@v2      # secretos en el repo
      - uses: aquasecurity/trivy-action@master # CVE en la imagen
        with: { scan-type: fs, severity: 'CRITICAL,HIGH', exit-code: '1' }
```

```yaml
# k8s: probes coherentes con A-03
livenessProbe:  { httpGet: { path: /api/v1/health,       port: 3000 }, periodSeconds: 10, failureThreshold: 3 }
readinessProbe: { httpGet: { path: /api/v1/health/ready, port: 3000 }, periodSeconds: 5 }
resources:
  requests: { cpu: 250m, memory: 512Mi }
  limits:   { cpu: '1',  memory: 1Gi }     # ⚠ ajustar al alza si no se corrige C-03
```

`.dockerignore` **debe** incluir `.env`, `node_modules`, `dist`, `.git` —sin él, el `.env` con secretos acaba dentro de la imagen. **Prioridad: P1.**

---

## A-12 — Sin MFA y sin registro de auditoría

Para un backend Enterprise ambos son requisito, no mejora: SOC 2 CC6.1/CC7.2, ISO 27001 A.9.4.2, PCI-DSS 8.3 y 10.2 los exigen explícitamente.

- **MFA/2FA:** ausente por completo. Con C-01 sin corregir, una sola credencial filtrada = compromiso total.
- **Auditoría:** solo existe `UserRole.assignedBy`. No hay registro de quién creó, modificó o borró qué, ni de logins, ni de cambios de permisos. **Tras un incidente es imposible reconstruir lo ocurrido.**

**Corrección:**
```prisma
model AuditLog {
  id        String   @id @default(uuid()) @db.Uuid
  actorId   String?  @db.Uuid
  action    String   // "user.roles.set", "auth.login.success", "role.permissions.set"
  targetType String?
  targetId  String?  @db.Uuid
  metadata  Json?
  ip        String?
  userAgent String?
  createdAt DateTime @default(now())

  @@index([actorId, createdAt])
  @@index([targetId, createdAt])
  @@index([action, createdAt])
  @@map("audit_logs")
}

model User {
  // ...
  mfaSecret       String?    // TOTP, cifrado con KMS
  mfaEnabledAt    DateTime?
  mfaRecoveryCodes String[]  // hasheados, de un solo uso
}
```

El log de auditoría debe ser **append-only** (revocar `UPDATE`/`DELETE` al rol de la aplicación) y replicarse a almacenamiento inmutable (S3 Object Lock / CloudWatch Logs). Un atacante con acceso a la BD no debe poder borrar sus huellas. **Prioridad: P1.**

---

## A-13 — Paginación por OFFSET

`skip: (page - 1) * limit` obliga a PostgreSQL a leer y descartar todas las filas anteriores. En la página 5.000 con `limit=20` son 100.000 filas leídas para devolver 20. La latencia **crece linealmente con la profundidad**.

**Corrección — paginación por cursor (keyset):**
```ts
export const listUsersQuerySchema = z.object({
  cursor: z.string().uuid().optional(),        // id del último elemento visto
  limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(20),
  // ...
});

const items = await prisma.user.findMany({
  where, take: query.limit + 1,                // +1 para saber si hay más
  ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],   // desempate estable: sin él se saltan filas
});
const hasNext = items.length > query.limit;
```
Coste **constante** con la profundidad. Es lo que usan las APIs de Stripe, GitHub y Slack. Se puede mantener OFFSET para el panel de administración (pocas páginas) y exponer cursor en la API pública. **Prioridad: P2.**

---

## A-14 — Pool de conexiones sin configurar, sin PgBouncer

Prisma usa por defecto `num_cpus × 2 + 1` conexiones **por instancia**. Con 20 pods de 4 vCPU son **180 conexiones**; el `max_connections` por defecto de PostgreSQL es 100. Resultado: `FATAL: sorry, too many clients already` y caída total.

**Corrección:**
```bash
DATABASE_URL="postgresql://...?connection_limit=10&pool_timeout=10&connect_timeout=5&statement_timeout=15000"
```
Y **PgBouncer en modo `transaction`** delante (obligatorio a partir de ~10 réplicas), con `pgbouncer=true` en la URL de Prisma para desactivar los prepared statements. A partir de ahí, réplicas de lectura para las listas. **Prioridad: P1 al escalar horizontalmente.**

---

## A-15 — Sin timeouts HTTP

**Verificado:** ningún `requestTimeout`, `headersTimeout` ni `keepAliveTimeout` en el código. Se heredan los de Node (300 s / 60 s), demasiado permisivos: 1.000 conexiones lentas mantenidas abiertas agotan los sockets (**Slowloris**, CWE-400).

**Corrección:**
```ts
const server = app.listen(env.PORT, () => { /* ... */ });

server.headersTimeout   = 10_000;  // cabeceras completas en 10s o se corta
server.requestTimeout   = 30_000;  // ninguna request vive más de 30s
server.keepAliveTimeout = 65_000;  // > idle timeout del ALB (60s), evita 502 en carrera
server.maxRequestsPerSocket = 1000;
```
`keepAliveTimeout` **mayor** que el del balanceador es un detalle no obvio: al revés, el LB reutiliza un socket que Node acaba de cerrar y el cliente recibe un 502 esporádico imposible de depurar. **Prioridad: P2.**

---

# 🟡 MEDIOS

## M-01 — Enumeración de cuentas por status code

**Verificado:**
```
correo inexistente  -> 401 INVALID_CREDENTIALS
correo suspendido   -> 403 ACCOUNT_SUSPENDED     💥
correo sin verificar-> 403 EMAIL_NOT_VERIFIED    💥
registro duplicado  -> 409 CONFLICT              💥 (vs 201)
```
El mensaje se unificó, pero **el código de estado sigue siendo el oráculo**. Un atacante valida una lista de correos filtrados a velocidad de red, y arma campañas de phishing dirigidas.

**Corrección:** unificar respuesta en la ruta pública y mover el detalle a un canal autenticado o al correo.
```ts
// Todas las rutas públicas devuelven 401 INVALID_CREDENTIALS o 200 genérico.
// El motivo real llega al usuario legítimo por email, no por HTTP.
if (user.status === UserStatus.SUSPENDED) {
  await sendMail({ to: user.email, ...templates.securityAlert({ title: 'Cuenta suspendida', ... }) });
  throw AppError.unauthorized('Correo o contraseña incorrectos.', ErrorCode.INVALID_CREDENTIALS);
}
```
```ts
// Registro: 202 Accepted SIEMPRE, exista o no la cuenta.
// Si ya existe, se envía un "alguien intentó registrarse con tu correo" en vez de crear nada.
return res.status(202).json({ message: 'Si el correo es válido, recibirás instrucciones.' });
```
**Contrapartida honesta:** empeora la UX ("¿por qué no puedo entrar?"). Es el compromiso que aceptan Google y GitHub. Para un producto B2B interno, quizá no compense; **debe ser una decisión consciente y documentada**, no un descuido. **Prioridad: P2.**

---

## M-02 — La cuenta bloqueada revela si la contraseña es correcta

**Verificado:**
```
Cuenta bloqueada + contraseña MALA   -> INVALID_CREDENTIALS
Cuenta bloqueada + contraseña BUENA  -> ACCOUNT_LOCKED       💥
```
`assertUsable()` se ejecuta **después** de `verifyPassword`. El bloqueo impide entrar pero **no impide confirmar la credencial**: el atacante sigue haciendo fuerza bruta durante el bloqueo y sabe cuándo acertó. La credencial validada sirve para reutilizarla en otros servicios (*credential stuffing*).

**Corrección:** comprobar el estado **antes** de verificar la contraseña. Ahorra además el 80 ms de scrypt (mitiga C-03).
```ts
export async function login(input: LoginInput, meta: RequestMeta): Promise<AuthResult> {
  const user = await prisma.user.findFirst({ where: { email: input.email, deletedAt: null } });

  // Estado ANTES que credencial: un bloqueo no debe ser un oráculo.
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    throw AppError.unauthorized('Correo o contraseña incorrectos.', ErrorCode.INVALID_CREDENTIALS);
  }

  const valid = await verifyPassword(input.password, user?.passwordHash ?? null);
  // ...
}
```
**Prioridad: P2.**

---

## M-03 — `z.string().url()` acepta `javascript:` → XSS almacenado

**Verificado:**
```
PATCH /users/me {"avatarUrl":"javascript:alert(document.cookie)"} -> 200 OK 💥
avatarUrl = "javascript:alert(document.cookie)"  ⇦ servido a todo cliente que lo renderice
```
`z.string().url()` usa `new URL()`, que acepta **cualquier esquema**: `javascript:`, `data:`, `file:`, `vbscript:`. Si el frontend hace `<a href={user.avatarUrl}>` la ejecución es directa; con `data:text/html` en un `<iframe>`, también. El backend está **almacenando y sirviendo la carga útil**: es XSS almacenado con el backend como vector, aunque la ejecución ocurra en el cliente (OWASP A03:2021).

**Corrección:**
```ts
// core/http/schemas.ts — reutilizable en todo el proyecto
export const urlSegura = z.string().max(2048).superRefine((valor, ctx) => {
  let url: URL;
  try { url = new URL(valor); }
  catch { return ctx.addIssue({ code: 'custom', message: 'URL inválida.' }); }

  if (!['http:', 'https:'].includes(url.protocol)) {
    ctx.addIssue({ code: 'custom', message: 'Solo se permiten URLs http o https.' });
  }
  // Anti-SSRF: si alguna vez el backend descarga la imagen, esto ya está cubierto.
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\])/.test(url.hostname)) {
    ctx.addIssue({ code: 'custom', message: 'No se permiten direcciones internas.' });
  }
});
```
**Prioridad: P2.**

---

## M-04 — Respuestas con JWT sin `Cache-Control: no-store`

**Verificado:** `cache-control = AUSENTE` en la respuesta de `/auth/login`, que contiene el access token.

Sin esa cabecera, un proxy corporativo, un CDN mal configurado o el propio navegador pueden almacenar la respuesta. **CWE-525, ASVS §8.2.1.**

**Corrección:**
```ts
// core/middleware/no-store.ts
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  next();
};

// auth.routes.ts — todo el módulo de autenticación
router.use(noStore);
```
**Prioridad: P2.**

---

## M-05 — `X-Request-Id` del cliente reflejado sin validar

**Verificado:** una cabecera de 64 caracteres arbitrarios se refleja íntegra en la respuesta y entra en todos los logs.

Node bloquea el CRLF (`ERR_INVALID_CHAR`), así que no hay *response splitting* —pero sí **contaminación de la correlación de logs** y **falsificación de trazas de auditoría**: el atacante fija el `requestId` de sus peticiones al de otro usuario para ensuciar la investigación forense. Además, provocar el `ERR_INVALID_CHAR` genera un 500 → DoS barato.

**Corrección:**
```ts
export const requestContext: RequestHandler = (req, res, next) => {
  const entrante = req.headers['x-request-id'];
  // Allowlist estricta. Lo que no encaje se descarta y se genera uno propio.
  const valido = typeof entrante === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(entrante);
  const requestId = valido ? entrante : crypto.randomUUID();

  res.locals.requestId = requestId;
  // Se distingue el id propio del que trajo el cliente: la traza no se confunde.
  if (valido) res.locals.upstreamRequestId = entrante;
  res.setHeader('X-Request-Id', requestId);
  next();
};
```
**Prioridad: P3.**

---

## M-06 — El seed puede regalar superadmin a una cuenta preexistente

**Ubicación:** [seed.ts:60](prisma/seed.ts#L60)

```ts
const existente = await prisma.user.findUnique({ where: { email: env.SEED_ADMIN_EMAIL } });
if (existente) { await prisma.userRole.upsert({ ... superadmin ... }); }
```
Si un atacante registra `admin@plantilla.dev` **antes** de que se ejecute el seed —el valor por defecto está publicado en `.env.example`— el propio seed le concede superadmin. Ventana real en cualquier despliegue donde el seed corre después del arranque de la aplicación.

**Corrección:**
```ts
if (existente) {
  if (!existente.emailVerifiedAt || existente.passwordHash === null) {
    throw new Error(
      `Existe una cuenta no verificada con ${env.SEED_ADMIN_EMAIL}. ` +
      `El seed NO le concederá superadmin. Revisa si es legítima antes de continuar.`,
    );
  }
  console.log(`⚠ Concediendo superadmin a la cuenta EXISTENTE ${env.SEED_ADMIN_EMAIL}`);
  // ...
}
```
Y ejecutar el seed **antes** de exponer la aplicación al tráfico (initContainer / job de migración). **Prioridad: P2.**

---

## M-07 — El seed borra los permisos personalizados de los roles de sistema

`seed.ts:44` hace `rolePermission.deleteMany()` y recrea desde el código en **cada ejecución**. Si un administrador ajustó los permisos del rol `admin` por API, el siguiente despliegue los revierte en silencio. Cambio de autorización no solicitado y sin traza.

**Corrección:** los roles de sistema deben ser **inmutables por API** (ya propuesto en C-02); así el seed es la única fuente de verdad y el conflicto desaparece por diseño. Para roles no-sistema, el seed no debe tocarlos jamás. **Prioridad: P2.**

---

## M-08 — Errores de Prisma logueados con parámetros de consulta

`error-handler.ts:63` hace `logger.error({ err: error }, ...)`. Un `PrismaClientKnownRequestError` incluye en `message` un fragmento de la consulta con sus parámetros. En `user.create` eso puede arrastrar el email y otros datos personales al log. La configuración `redact` de pino actúa sobre **rutas de propiedades**, no sobre texto libre dentro de `err.message`.

**Corrección:**
```ts
if (appError.status >= 500) {
  logger.error({
    err: { name: error?.constructor?.name, message: sanear(String(error?.message)), stack: error?.stack },
    requestId, path: req.originalUrl, method: req.method,
  }, 'Error no controlado');
}

/** Recorta el mensaje y enmascara lo que parezca PII. */
function sanear(msg: string): string {
  return msg
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, '[tarjeta]')
    .slice(0, 1000);
}
```
**Prioridad: P2 (P1 si aplica RGPD/HIPAA).**

---

## M-09 — Sin OpenAPI

No hay contrato publicable: ni SDK generado, ni tests de contrato, ni documentación sincronizada con el código.

**Corrección — derivar el spec de los schemas de Zod que ya existen** (fuente única, imposible que se desincronice):
```ts
import { extendZodWithOpenApi, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
extendZodWithOpenApi(z);

registry.registerPath({
  method: 'post', path: '/auth/login', tags: ['auth'],
  request: { body: { content: { 'application/json': { schema: loginSchema } } } },
  responses: { 200: { description: 'Sesión iniciada', content: { 'application/json': { schema: loginResponseSchema } } } },
});
```
**Prioridad: P2.**

---

## M-10 — Sin idempotencia en POST

Un reintento de `POST /users` tras un timeout crea un duplicado. Sin `Idempotency-Key` no hay forma segura de reintentar.

**Corrección — el patrón de Stripe:**
```ts
export const idempotencia: RequestHandler = async (req, res, next) => {
  const clave = req.get('Idempotency-Key');
  if (!clave || req.method !== 'POST') return next();

  const cacheada = await redis.get(`idem:${req.auth?.id}:${clave}`);
  if (cacheada) { const { status, body } = JSON.parse(cacheada); return res.status(status).json(body); }

  const jsonOriginal = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 500) void redis.setEx(`idem:${req.auth?.id}:${clave}`, 86400, JSON.stringify({ status: res.statusCode, body }));
    return jsonOriginal(body);
  };
  next();
};
```
**Prioridad: P3.**

---

## M-11 — `npm run lint` está roto

**Verificado:** `"lint": "eslint src --ext .ts"` y **eslint no figura en `dependencies` ni en `devDependencies`**; tampoco existe fichero de configuración. El comando falla siempre. Un script roto en `package.json` es peor que no tenerlo: da falsa sensación de cobertura y romperá el CI del ejemplo en A-11.

**Corrección:**
```bash
npm i -D eslint @eslint/js typescript-eslint eslint-plugin-security prettier eslint-config-prettier
```
```js
// eslint.config.js
import js from '@eslint/js';
import ts from 'typescript-eslint';
import security from 'eslint-plugin-security';
import prettier from 'eslint-config-prettier';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.strictTypeChecked,
  security.configs.recommended,
  prettier,
  {
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      complexity: ['warn', 12],
      'max-lines-per-function': ['warn', 60],
    },
  },
);
```
**Prioridad: P2.**

---

## M-12 — Sin tests reales

Existe `src/self-check.ts` (57 aserciones que cubren hashing, RBAC, autoload y plantillas), pero:
- no hay **tests de integración** contra la BD,
- no hay **cobertura medible**,
- no hay **tests de regresión de seguridad** —y sin ellos, C-01 y C-02 volverán con el próximo refactor,
- no hay CI que los ejecute.

**Corrección — empezar por los que impiden la reincidencia:**
```ts
// tests/security/escalada.test.ts — vitest + testcontainers
describe('RBAC · prevención de escalada', () => {
  it('un usuario con users:assign-roles NO puede concederse superadmin', async () => {
    const gestor = await crearUsuarioCon(['users:assign-roles']);
    const res = await api.put(`/users/${gestor.id}/roles`).auth(gestor.token).send({ roles: ['superadmin'] });
    expect(res.status).toBe(403);
    expect(await permisosDe(gestor.id)).not.toContain('*');
  });

  it('un usuario con roles:assign-permissions NO puede concederse el comodín', async () => {
    const gestor = await crearUsuarioCon(['roles:assign-permissions']);
    const res = await api.put(`/roles/${gestor.roleId}/permissions`).auth(gestor.token).send({ permissions: ['*'] });
    expect(res.status).toBe(403);
  });

  it('nadie puede editar sus propios roles', async () => { /* ... */ });
});
```
Objetivo realista: **cobertura ≥85 % en `core/` y `modules/*/service.ts`**, 100 % en las rutas de autorización. **Prioridad: P2.**

---

## M-13 — Cero constraints CHECK en la base de datos

**Verificado:** `SELECT count(*) FROM pg_constraint WHERE contype='c'` → **0**.

Toda la integridad depende de que la aplicación se comporte. Cualquier escritura fuera de Prisma —migración, script, incidencia— puede dejar datos imposibles: un permiso con formato inválido, `expiresAt < createdAt`, un email vacío.

**Corrección:**
```sql
ALTER TABLE permissions ADD CONSTRAINT permissions_action_formato
  CHECK (action = '*' OR action ~ '^[a-z0-9-]+:[a-z0-9-]+$');

ALTER TABLE users ADD CONSTRAINT users_email_formato
  CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

ALTER TABLE sessions ADD CONSTRAINT sessions_expira_despues
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE users ADD CONSTRAINT users_borrado_coherente
  CHECK (("deletedAt" IS NULL) = (status <> 'DELETED'));

ALTER TABLE verification_tokens ADD CONSTRAINT vt_consumo_coherente
  CHECK ("consumedAt" IS NULL OR "consumedAt" >= "createdAt");
```
La base de datos es la última línea de defensa y **sobrevive a todas las versiones de la aplicación**. **Prioridad: P2.**

---

## M-14 — `trust proxy: 1` fijo

`app.set('trust proxy', 1)` confía en **exactamente un** proxy. Con CloudFront + ALB + Ingress hay tres saltos: `req.ip` devuelve la IP del proxy intermedio, no la del cliente. Todo el rate limiting pasa a agrupar a **todos los usuarios bajo una sola IP** → o se bloquea a todo el mundo, o el atacante lo evade inyectando `X-Forwarded-For`.

**Corrección:**
```ts
TRUST_PROXY: z.union([z.literal('false'), z.coerce.number().int().min(0).max(10), z.string()])
  .default('false'),
```
```ts
if (env.TRUST_PROXY !== 'false') app.set('trust proxy', env.TRUST_PROXY);
```
Lo más seguro es **listar los CIDR de confianza**, no un contador de saltos. **Prioridad: P2.**

---

## M-15 — Sin PKCE en OAuth

El flujo usa `client_secret` (cliente confidencial), así que PKCE no es estrictamente obligatorio en OAuth 2.0. Pero **OAuth 2.1 lo exige para todos los clientes** y protege frente a interceptación del `code` (proxy corporativo, extensión de navegador, log de redirecciones).

**Corrección:**
```ts
// providers/google.ts
getAuthorizationUrl(state: string, codeChallenge: string) {
  const params = new URLSearchParams({
    /* ... */ state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${params}`;
}
```
```ts
// auth.controller.ts — el verifier viaja en cookie httpOnly, junto al state
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
res.cookie(COOKIES.oauthVerifier, verifier, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax', maxAge: 600_000 });
```
**Prioridad: P3.**

---

## M-16 — 10 dependencias desactualizadas

```
@prisma/client 6.19.3 → 7.9.1   |  zod        3.25.76 → 4.4.3
prisma         6.19.3 → 7.9.1   |  nodemailer  6.10.1 → 9.0.4  (⚠ C-07)
pino            9.14.0 → 10.3.1  |  express-rate-limit 7.5.1 → 8.6.2
pino-http       10.5.0 → 11.0.0  |  typescript   5.9.3 → 7.0.2
@types/node    22.20.1 → 26.1.2  |  @types/nodemailer 6.4.24 → 8.0.1
```
Zod 4 aporta mejoras de rendimiento de un orden de magnitud en validación —relevante en la ruta caliente de cada request. Prisma 7 mejora el pooling y `relationJoins` (A-05).

**Corrección:** actualizar por lotes con tests verdes entre cada uno, empezando por `nodemailer` (C-07). Renovate con auto-merge para parches y PR agrupada para menores. **Prioridad: P2.**

---

# 🟢 BAJOS

| ID | Hallazgo | Corrección |
|---|---|---|
| **B-01** | `req.query as never` en `users.controller.ts:7` y `roles.controller.ts:7` **viola el §11 del propio CLAUDE.md** ("nada de aserciones `as` para callar al compilador") | Tipar el handler con `RequestHandler<P, ResBody, ReqBody, z.infer<typeof listUsersQuerySchema>>` |
| **B-02** | Código muerto: `optionalAuthenticate`, `requireVerifiedEmail`, `requireRoles`, `AppError.isOperational` y los helpers `Body/Query/Params` — **0 consumidores**. Viola el §12 (sin abstracción especulativa) | Borrar. `requireRoles` puede mantenerse si se documenta un caso de uso real |
| **B-03** | `dist/self-check.js` se publica en la imagen de producción, con secretos de relleno dentro | Excluir de `tsconfig.json` (`"exclude": ["src/self-check.ts"]`) y moverlo a `tests/` |
| **B-04** | `issueSession` consulta `findUniqueOrThrow` por `tokenHash` para recuperar un id que `create` ya devolvió | Se resuelve al aplicar C-05 |
| **B-05** | `bool` de env solo acepta `'true'`/`'false'`: `TRUST_PROXY=1` mata el arranque | `z.union([z.enum(['true','1','yes']).transform(() => true), ...])` |
| **B-06** | `express.urlencoded({ extended: true })` innecesario en una API JSON; añade `qs` a la superficie de ataque | `express.urlencoded({ extended: false, limit: '100kb' })` o eliminarlo |
| **B-07** | `compression()` sobre respuestas que contienen JWT: vector teórico de BREACH | `compression({ filter: (req, res) => !res.getHeader('Cache-Control')?.includes('no-store') })` |
| **B-08** | Faltan `.nvmrc`, `.editorconfig`, `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md` | Añadirlos; `SECURITY.md` es requisito para divulgación responsable |

---

# Análisis de escalabilidad

| Usuarios | Veredicto | Cuello de botella dominante |
|---|---|---|
| **100** | ✅ Correcto | Ninguno |
| **1.000** | ✅ Correcto | Nada crítico en una sola instancia |
| **10.000** | ⚠️ Degradado | A-05 (4 consultas/request) satura el pool (A-14). Búsqueda ya lenta |
| **100.000** | ❌ Inviable | C-06 Seq Scan en cada búsqueda; A-06 millones de sesiones muertas; A-02 rate limit inservible con varias réplicas |
| **1.000.000** | ❌ Colapso | C-03 tumba cualquier instancia con 16 req/s. Sin caché, sin réplicas de lectura, sin particionado |
| **10 M+** | ❌ Rediseño | Requiere sharding, event sourcing para auditoría, servicio de autenticación separado, CQRS en listados |

**Techo actual estimado: ~5.000 usuarios activos** con una sola instancia y ningún atacante.
**Tras Fases 1–3: ~500.000** con 10 réplicas, Redis, PgBouncer y réplicas de lectura.

---

# Aciertos del diseño actual

Una auditoría que solo enumera defectos no es útil. Estos elementos **deben conservarse** en el refactor:

1. **Contrato de respuesta uniforme** con `requestId` en cada respuesta — mejor que la mayoría de APIs en producción.
2. **Refresh tokens opacos, hasheados con SHA-256 en BD** — un volcado de la tabla no permite suplantar. Correcto de libro.
3. **Algoritmo JWT fijado (`algorithms: ['HS256']`)** — cierra el ataque `alg: none` y la confusión de algoritmos.
4. **`verifyPassword` ejecuta scrypt aun sin usuario** — mitigación de timing bien planteada (aunque agrava C-03: hay tensión real entre ambos objetivos).
5. **`state` en cookie httpOnly + `safeEqual`** — CSRF de OAuth correctamente cubierto.
6. **Access token en el fragmento (`#`)** — no llega a logs de proxies ni al `Referer`.
7. **Autoload de rutas con `fs.readdirSync({recursive})`** — resuelve el requisito sin dependencias y sin magia.
8. **Validación de entorno con *fail fast*** — el proceso muere al arrancar, no en la primera petición. Fue la que detectó `LOG_LEVEL=silent` durante esta misma auditoría.
9. **Direccionalidad de dependencias `modules → core → config`** sin ciclos — verificado.
10. **Plantillas de email sin marca hardcodeada**, con escapado y versión de texto plano.

---

# Roadmap

### Fase 1 — Críticos · bloquean producción (5–8 días)
| # | Tarea | ID |
|---|---|---|
| 1 | Regla de no-escalada en `setRoles` + prohibir auto-edición de roles | C-01 |
| 2 | Prohibir `*` por API + inmutabilidad de roles de sistema | C-02 |
| 3 | Rotación de refresh atómica (CAS) con ventana de gracia | C-05 |
| 4 | Rechazar secretos de ejemplo; `.env.example` con valores vacíos | C-04 |
| 5 | Semáforo de scrypt + `UV_THREADPOOL_SIZE` + recalibrar parámetros | C-03 |
| 6 | `npm i nodemailer@^9` + `npm audit` como gate | C-07 |
| 7 | Índice GIN trigram + índice único `lower(email)` | C-06, A-08 |
| 8 | **Tests de regresión de las escaladas** — sin ellos, C-01/C-02 vuelven | M-12 |

### Fase 2 — Altos · antes del primer cliente real (8–12 días)
Schemas separados `/me` vs `/:id` (A-01) · rate limit en Redis por IP+cuenta (A-02) · excluir `/health` del límite (A-03) · limpieza de `accounts` en el borrado (A-04) · job de purga de sesiones (A-06) · eliminar tokens OAuth del modelo (A-07) · seed compilado (A-09) · `COOKIE_SAMESITE` configurable (A-10) · Dockerfile + CI + probes (A-11) · `AuditLog` + MFA TOTP (A-12) · pool + PgBouncer (A-14) · timeouts HTTP (A-15).

### Fase 3 — Mejoras importantes (10–15 días)
Caché RBAC en Redis con invalidación por versión (A-05) · paginación por cursor (A-13) · unificación anti-enumeración (M-01, M-02) · `urlSegura` (M-03) · `no-store` (M-04) · `X-Request-Id` validado (M-05) · endurecer seed (M-06, M-07) · saneado de logs (M-08) · OpenAPI desde Zod (M-09) · ESLint + Prettier (M-11) · CHECK constraints (M-13) · `trust proxy` configurable (M-14).

### Fase 4 — Refactorización (10–15 días)
Capa de repositorio (aísla Prisma del dominio y hace testeable el servicio sin BD) · `Result<T,E>` en servicios en vez de excepciones para errores esperados · eliminar código muerto y `as never` (B-01, B-02) · extraer `core/` a paquete versionado si habrá varios servicios · dominio de autenticación como módulo con frontera explícita, candidato a extraerse.

### Fase 5 — Optimización (continuo)
PKCE (M-15) · idempotencia (M-10) · réplicas de lectura para listados · particionado de `sessions` y `audit_logs` por rango temporal · OpenTelemetry + tracing distribuido · SLO/SLI con alertas · k6 en CI para detectar regresiones de rendimiento · actualización de dependencias (M-16) · chaos engineering sobre la ruta de autenticación.

---

# Nota metodológica

Este informe audita código escrito en la sesión anterior por mí mismo. Tres hallazgos —**B-01** (`as never`), **B-02** (código muerto) y **A-07** (guardar tokens sin usarlos)— son **incumplimientos de las reglas que yo mismo redacté en `CLAUDE.md`**. El comentario `// ponytail:` de `password.ts` declaraba un techo ("migrar a argon2 si una auditoría lo exige") que **no era el techo real**: el problema no es el algoritmo, son los parámetros sin control de concurrencia (C-03).

Que 21 de 45 hallazgos se reprodujeran ejecutando código, y que 2 de ellos sean escaladas de privilegio completas en el subsistema descrito como *"estrictamente profesional sin errores"*, es el dato más relevante del informe: **la revisión estática y los 57 checks de la suite anterior no los detectaron.** Solo aparecieron al construir un atacante con permisos delegados y dejarle intentar la escalada.

**Recomendación de proceso:** ningún cambio en `core/rbac/`, `core/middleware/authorize.ts` o los servicios de `users`/`roles` debe fusionarse sin un test de regresión de escalada que falle antes del cambio y pase después.
