# Política de seguridad

## Reportar una vulnerabilidad

No abras un issue público. Escribe a **soporte@plantilla.dev** con:

- descripción y ruta de explotación,
- prueba de concepto mínima,
- impacto que estimas.

Respondemos en 48 h laborables y publicamos un arreglo coordinado.
Agradecemos públicamente a quien reporte, salvo que prefiera el anonimato.

## Alcance

En alcance: autenticación, autorización (RBAC), gestión de sesiones, inyección,
exposición de datos y toda la superficie de `/api/v1`.

Fuera de alcance: ingeniería social, DoS volumétrico contra infraestructura de
terceros, y hallazgos que exigen acceso físico o credenciales ya comprometidas.

## Garantías del diseño

| Control | Dónde |
|---|---|
| No-escalada de privilegios, en los dos sentidos | `src/core/rbac/guards.ts` + las dos guardas de `setRoles` |
| Hashing scrypt con semáforo de concurrencia | `src/core/security/password.ts` |
| Autenticación por credenciales y sesiones | Better Auth, en `src/core/auth/auth.ts` |
| MFA TOTP con códigos de respaldo y bloqueo por fuerza bruta | plugin `twoFactor` |
| CSRF por origen en toda la API, cerrando en fallo | `src/core/middleware/security.ts` |
| Rechazo de contraseñas filtradas (k-anonimato HIBP) | plugin `haveIBeenPwned` |
| Auditoría append-only (trigger en PostgreSQL) | migración `init_better_auth_rbac` |
| Integridad independiente de la aplicación | CHECK constraints en la misma migración |

### Lo que NO garantiza

Conviene ser explícito, porque el modelo de sesión cambió al adoptar Better Auth:

- **No hay detección de reuso de token.** Antes los refresh tokens rotaban y un
  token reutilizado revocaba todas las sesiones. Better Auth no rota: un token
  robado sirve hasta que caduque (`SESSION_TTL_DAYS`) o se revoque a mano.
- **No hay bloqueo de cuenta por intentos fallidos.** Lo sustituye el rate limit
  por IP y endpoint. Un atacante con muchas IPs tiene más margen que antes.
- **Revocar una sesión tarda hasta `SESSION_COOKIE_CACHE_SECONDS`** en notarse si
  la caché de cookie está activa. Suspender a un usuario **sí** es inmediato: el
  estado de la cuenta se revalida contra la base de datos en cada petición.

El razonamiento completo está en `CLAUDE.md` §15.

Cualquier cambio en `core/rbac/` o en los servicios de `users`/`roles` exige un
test de regresión de escalada que falle antes del cambio y pase después.

## Antes de desplegar

- [ ] `BETTER_AUTH_SECRET` generado con `openssl rand -base64 48` (48+ caracteres)
- [ ] `REDIS_URL` configurada (obligatoria en producción)
- [ ] `COOKIE_SECURE=true` y `COOKIE_SAMESITE` acorde al despliegue
- [ ] `CORS_ORIGINS` solo con https y sin comodines: también son los
      `trustedOrigins` de Better Auth, así que un valor de más es un open redirect
- [ ] `TRUST_PROXY` con el número real de proxies delante
- [ ] `SEED_ADMIN_PASSWORD` cambiada y segundo factor activado en esa cuenta
- [ ] `npm run audit:prod` limpio (CVE altas en dependencias de producción)
- [ ] Decidido `PASSWORD_BREACH_CHECK`: falla cerrado si HaveIBeenPwned no responde
