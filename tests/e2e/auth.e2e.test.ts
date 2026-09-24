import crypto from 'node:crypto';
import { describe, expect, inject, it } from 'vitest';
import { env } from '../../src/config/env';
import { AUDIT } from '../../src/core/audit/audit';
import { SYSTEM_ROLES } from '../../src/core/rbac/permissions';
import { ORIGEN, Sesion, credenciales, emailUnico, prismaE2E } from './cliente';

/**
 * T13 (ola E2): autenticacion, sesiones, 2FA, CSRF y limites (parte "auth").
 * Los limites (rate limit) van en `limites.e2e.test.ts`, con su propio
 * servidor: aqui se corre contra el servidor compartido de `global-setup.ts`,
 * que arranca con limites altos (E1) para no interferir con estas pruebas.
 *
 * E0: nada de supertest. Todo habla HTTP de verdad contra el proceso real.
 */

const BASE = inject('e2eUrl');
const PREFIJO = env.API_PREFIX;

/** Contraseña propia de este archivo (no la exporta cliente.ts). Cumple PASSWORD_POLICY
 * y no contiene el usuario local de `emailUnico()` (solo trae "e2e", digitos y guiones). */
const PASSWORD_E2E = 'HospitalIntel2026!Segura';
const PASSWORD_E2E_NUEVA = 'OtraClaveSegura2026!X';

// ─── Helpers de estrechamiento de tipos (sin `any`, CLAUDE.md §11) ───────────

function comoRegistro(valor: unknown): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null) {
    throw new Error(`Se esperaba un objeto JSON; se recibio: ${JSON.stringify(valor)}`);
  }
  return valor as Record<string, unknown>;
}

function comoTexto(valor: unknown): string {
  if (typeof valor !== 'string') throw new Error(`Se esperaba un string; se recibio: ${JSON.stringify(valor)}`);
  return valor;
}

function comoBooleano(valor: unknown): boolean {
  if (typeof valor !== 'boolean') throw new Error(`Se esperaba un booleano; se recibio: ${JSON.stringify(valor)}`);
  return valor;
}

function comoArregloDeTextos(valor: unknown): string[] {
  if (!Array.isArray(valor) || !valor.every((v): v is string => typeof v === 'string')) {
    throw new Error(`Se esperaba un arreglo de strings; se recibio: ${JSON.stringify(valor)}`);
  }
  return valor;
}

/** Nombre + valor de cada Set-Cookie de una respuesta, listos para reenviar como Cookie. */
function cookiesDeRespuesta(headers: Headers): string[] {
  return headers.getSetCookie().map((c) => c.split(';', 1)[0] ?? '');
}

function cabeceraCookieDeRespuesta(headers: Headers): string {
  return cookiesDeRespuesta(headers).join('; ');
}

// ─── TOTP (RFC 6238) calculado a mano, sin dependencias nuevas ───────────────

const BASE32_ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodificarBase32(valor: string): Buffer {
  const limpio = valor.replace(/=+$/u, '').toUpperCase();
  let bits = '';
  for (const caracter of limpio) {
    const indice = BASE32_ALFABETO.indexOf(caracter);
    if (indice === -1) throw new Error(`Caracter base32 invalido: ${caracter}`);
    bits += indice.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** Extrae el secreto base32 del `totpURI` que devuelve /two-factor/enable. */
function extraerSecretoTotp(totpURI: string): string {
  const secreto = new URL(totpURI).searchParams.get('secret');
  if (!secreto) throw new Error(`El totpURI no trae "secret": ${totpURI}`);
  return secreto;
}

/** TOTP HMAC-SHA1, 6 digitos, periodo 30s: igual que `two-factor/totp` de Better Auth. */
function totpActual(secretoBase32: string): string {
  const periodo = 30;
  const digitos = 6;
  const contador = Math.floor(Date.now() / 1000 / periodo);
  const bufferContador = Buffer.alloc(8);
  bufferContador.writeUInt32BE(Math.floor(contador / 2 ** 32), 0);
  bufferContador.writeUInt32BE(contador % 2 ** 32, 4);
  const hmac = crypto.createHmac('sha1', decodificarBase32(secretoBase32)).update(bufferContador).digest();
  const desplazamiento = hmac[hmac.length - 1]! & 0x0f;
  const binario =
    ((hmac[desplazamiento]! & 0x7f) << 24) |
    ((hmac[desplazamiento + 1]! & 0xff) << 16) |
    ((hmac[desplazamiento + 2]! & 0xff) << 8) |
    (hmac[desplazamiento + 3]! & 0xff);
  return (binario % 10 ** digitos).toString().padStart(digitos, '0');
}

// ─── Fixtures propios de este archivo ────────────────────────────────────────

async function iniciarSesionAdmin(): Promise<Sesion> {
  const admin = new Sesion(BASE);
  const login = await admin.login(credenciales.superadmin.email, credenciales.superadmin.password);
  if (login.status !== 200) throw new Error(`No se pudo iniciar sesion como superadmin (${login.status}).`);
  return admin;
}

/** Crea un usuario `@e2e.test` con rol CONSULTA vía el superadmin y devuelve sus credenciales e id. */
async function crearUsuarioPropio(admin: Sesion, etiqueta: string): Promise<{ id: string; email: string }> {
  const email = emailUnico();
  const creado = await admin.post(`${PREFIJO}/users`, {
    email,
    password: PASSWORD_E2E,
    name: `E2E auth ${etiqueta}`,
    roles: [SYSTEM_ROLES.CONSULTA.name],
  });
  if (creado.status !== 201) {
    throw new Error(`No se pudo crear el usuario "${etiqueta}": ${creado.status} ${JSON.stringify(creado.body)}`);
  }
  const id = comoTexto(comoRegistro(comoRegistro(creado.body).data).id);
  return { id, email };
}

describe('T13 - autenticacion, sesiones, 2FA y CSRF', () => {
  describe('login basico', () => {
    it('superadmin, director y farmacia inician sesion con cookie HttpOnly + SameSite=Lax', async () => {
      for (const cred of [credenciales.superadmin, credenciales.director, credenciales.farmacia]) {
        const sesion = new Sesion(BASE);
        const respuesta = await sesion.login(cred.email, cred.password);
        expect(respuesta.status).toBe(200);

        const cookieSesion = cookiesDeRespuesta(respuesta.headers).find((c) => c.includes('session_token'));
        expect(cookieSesion, 'falta la cookie de sesion en el login').toBeDefined();
        // El atributo va en la cabecera Set-Cookie completa, no en el par nombre=valor.
        const setCookieCompleta = respuesta.headers
          .getSetCookie()
          .find((c) => c.includes('session_token'))!
          .toLowerCase();
        expect(setCookieCompleta).toContain('httponly');
        expect(setCookieCompleta).toContain('samesite=lax');
      }
    });

    it('GET /auth/get-session y GET /users/me devuelven roles y permisos exactos segun SYSTEM_ROLES', async () => {
      const casos = [
        { cred: credenciales.director, rol: SYSTEM_ROLES.DIRECTOR },
        { cred: credenciales.farmacia, rol: SYSTEM_ROLES.FARMACIA },
      ];

      for (const { cred, rol } of casos) {
        const sesion = new Sesion(BASE);
        const login = await sesion.login(cred.email, cred.password);
        expect(login.status).toBe(200);

        const sesionActual = await sesion.get(`${PREFIJO}/auth/get-session`);
        expect(sesionActual.status).toBe(200);
        const cuerpoSesion = comoRegistro(sesionActual.body);
        expect(comoTexto(comoRegistro(cuerpoSesion.user).email)).toBe(cred.email);

        const me = await sesion.get(`${PREFIJO}/users/me`);
        expect(me.status).toBe(200);
        const datosMe = comoRegistro(comoRegistro(me.body).data);
        expect(comoTexto(datosMe.email)).toBe(cred.email);
        expect(comoArregloDeTextos(datosMe.roles)).toEqual([rol.name]);
        expect(comoArregloDeTextos(datosMe.permissions)).toEqual([...rol.permissions].sort());
      }

      // El superadmin solo tiene el comodin: RolePermission le liga literalmente "*",
      // no la lista expandida (ver seed.ts y core/rbac/permissions.ts).
      const admin = await iniciarSesionAdmin();
      const meAdmin = await admin.get(`${PREFIJO}/users/me`);
      expect(meAdmin.status).toBe(200);
      const datosAdmin = comoRegistro(comoRegistro(meAdmin.body).data);
      expect(comoArregloDeTextos(datosAdmin.roles)).toEqual([SYSTEM_ROLES.SUPER_ADMIN.name]);
      expect(comoArregloDeTextos(datosAdmin.permissions)).toEqual(['*']);
    });

    it('contraseña incorrecta y correo inexistente responden 401 con el mismo mensaje (sin enumeracion)', async () => {
      const conClaveMala = await new Sesion(BASE).login(credenciales.director.email, 'ClaveIncorrecta123!');
      expect(conClaveMala.status).toBe(401);

      const conCorreoInexistente = await new Sesion(BASE).login(emailUnico(), 'CualquierClave123!');
      expect(conCorreoInexistente.status).toBe(401);

      const cuerpo1 = comoRegistro(await conClaveMala.json());
      const cuerpo2 = comoRegistro(await conCorreoInexistente.json());
      // Mismo codigo y mismo mensaje: nada distingue "existe pero clave mala" de "no existe".
      expect(cuerpo1.code).toBe(cuerpo2.code);
      expect(cuerpo1.message).toBe(cuerpo2.message);
    });

    it('un login correcto deja rastro de auditoria auth.login.success', async () => {
      const sesion = new Sesion(BASE);
      const respuesta = await sesion.login(credenciales.director.email, credenciales.director.password);
      expect(respuesta.status).toBe(200);
      const cuerpo = comoRegistro(await respuesta.json());
      const userId = comoTexto(comoRegistro(cuerpo.user).id);

      const fila = await prismaE2E().auditLog.findFirst({
        where: { action: AUDIT.loginOk, actorId: userId },
        orderBy: { createdAt: 'desc' },
      });
      expect(fila).not.toBeNull();
      expect(fila?.targetId).toBe(userId);
    });
  });

  describe('bearer', () => {
    it('el token de set-auth-token sirve como Authorization: Bearer, sin cookie', async () => {
      const sesion = new Sesion(BASE);
      const login = await sesion.login(credenciales.farmacia.email, credenciales.farmacia.password);
      expect(login.status).toBe(200);
      expect(sesion.token).toBeTruthy();

      const respuesta = await fetch(`${BASE}${PREFIJO}/users/me`, {
        headers: { Origin: ORIGEN, Authorization: `Bearer ${sesion.token!}` },
      });
      expect(respuesta.status).toBe(200);
      const cuerpo = comoRegistro(await respuesta.json());
      const datos = comoRegistro(cuerpo.data);
      expect(comoTexto(datos.email)).toBe(credenciales.farmacia.email);
    });
  });

  describe('logout', () => {
    it('logout responde 200 y audita auth.logout con ip', async () => {
      const admin = await iniciarSesionAdmin();
      const { email } = await crearUsuarioPropio(admin, 'logout-auditoria');

      const sesion = new Sesion(BASE);
      const login = await sesion.login(email, PASSWORD_E2E);
      expect(login.status).toBe(200);
      const userId = comoTexto(comoRegistro(comoRegistro(await login.json()).user).id);

      const salida = await sesion.post(`${PREFIJO}/auth/sign-out`);
      expect(salida.status).toBe(200);

      const fila = await prismaE2E().auditLog.findFirst({
        where: { action: AUDIT.logout, actorId: userId },
        orderBy: { createdAt: 'desc' },
      });
      expect(fila).not.toBeNull();
      expect(fila?.ip).toBeTruthy();
    });

    it('una cookie de sesion reenviada tras logout ya no autentica (cache de cookie desactivada)', async () => {
      const admin = await iniciarSesionAdmin();
      const { email } = await crearUsuarioPropio(admin, 'logout-replay');

      const sesion = new Sesion(BASE);
      const login = await sesion.login(email, PASSWORD_E2E);
      expect(login.status).toBe(200);

      const salida = await sesion.post(`${PREFIJO}/auth/sign-out`);
      expect(salida.status).toBe(200);

      // Misma `Sesion`, misma cookie que antes del logout ("robada y repetida").
      // Lo correcto seria 401; hoy responde 200 mientras la cache de cookie
      // (SESSION_COOKIE_CACHE_SECONDS) siga fresca.
      const siguiente = await sesion.get(`${PREFIJO}/users/me`);
      expect(siguiente.status).toBe(401);
    });
  });

  describe('registro publico', () => {
    it('POST /auth/sign-up/email responde 403: el registro publico esta bloqueado', async () => {
      const respuesta = await fetch(`${BASE}${PREFIJO}/auth/sign-up/email`, {
        method: 'POST',
        headers: { Origin: ORIGEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailUnico(), password: PASSWORD_E2E, name: 'Alguien' }),
      });
      expect(respuesta.status).toBe(403);
    });
  });

  describe('CSRF', () => {
    it('peticion mutante con cookie: sin Origin -> 403, con Origin no permitido -> 403, con el correcto -> pasa', async () => {
      const admin = await iniciarSesionAdmin();
      const { email } = await crearUsuarioPropio(admin, 'csrf');

      const sesion = new Sesion(BASE);
      const login = await sesion.login(email, PASSWORD_E2E);
      expect(login.status).toBe(200);
      const cookie = cabeceraCookieDeRespuesta(login.headers);
      expect(cookie).toContain('session_token');

      const sinOrigen = await fetch(`${BASE}${PREFIJO}/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ name: 'CSRF sin origen' }),
      });
      expect(sinOrigen.status).toBe(403);

      const origenNoPermitido = await fetch(`${BASE}${PREFIJO}/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Cookie: cookie },
        body: JSON.stringify({ name: 'CSRF origen malo' }),
      });
      expect(origenNoPermitido.status).toBe(403);

      const origenCorrecto = await fetch(`${BASE}${PREFIJO}/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: ORIGEN, Cookie: cookie },
        body: JSON.stringify({ name: 'CSRF origen bueno' }),
      });
      expect(origenCorrecto.status).toBe(200);
    });
  });

  describe('cuerpo de la peticion', () => {
    it('415 con Content-Type text/plain', async () => {
      const respuesta = await fetch(`${BASE}${PREFIJO}/users`, {
        method: 'POST',
        headers: { Origin: ORIGEN, 'Content-Type': 'text/plain' },
        body: 'hola',
      });
      expect(respuesta.status).toBe(415);
    });

    it('400 con JSON malformado', async () => {
      const respuesta = await fetch(`${BASE}${PREFIJO}/users`, {
        method: 'POST',
        headers: { Origin: ORIGEN, 'Content-Type': 'application/json' },
        body: '{ esto no es JSON valido',
      });
      expect(respuesta.status).toBe(400);
    });

    it('400 con un cuerpo por encima de BODY_LIMIT', async () => {
      const relleno = 'x'.repeat(300 * 1024); // BODY_LIMIT=256kb en .env
      const respuesta = await fetch(`${BASE}${PREFIJO}/users`, {
        method: 'POST',
        headers: { Origin: ORIGEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ relleno }),
      });
      expect(respuesta.status).toBe(400);
    });
  });

  describe('cambio de contraseña', () => {
    it('/auth/change-password: la nueva funciona, la vieja no, y se restaura al final', async () => {
      const admin = await iniciarSesionAdmin();
      const { email } = await crearUsuarioPropio(admin, 'change-password');

      const sesion = new Sesion(BASE);
      const login = await sesion.login(email, PASSWORD_E2E);
      expect(login.status).toBe(200);

      const cambio = await sesion.post(`${PREFIJO}/auth/change-password`, {
        currentPassword: PASSWORD_E2E,
        newPassword: PASSWORD_E2E_NUEVA,
      });
      expect(cambio.status).toBe(200);

      const conNueva = await new Sesion(BASE).login(email, PASSWORD_E2E_NUEVA);
      expect(conNueva.status).toBe(200);

      const conVieja = await new Sesion(BASE).login(email, PASSWORD_E2E);
      expect(conVieja.status).toBe(401);

      // Se restaura: sin `revokeOtherSessions`, la sesion original sigue viva.
      const restaurar = await sesion.post(`${PREFIJO}/auth/change-password`, {
        currentPassword: PASSWORD_E2E_NUEVA,
        newPassword: PASSWORD_E2E,
      });
      expect(restaurar.status).toBe(200);

      const conOriginalRestaurada = await new Sesion(BASE).login(email, PASSWORD_E2E);
      expect(conOriginalRestaurada.status).toBe(200);
    });
  });

  describe('2FA TOTP de punta a punta', () => {
    it('enable -> verify -> el login exige 2FA -> codigo incorrecto rechazado -> codigo correcto abre sesion -> disable', async () => {
      const admin = await iniciarSesionAdmin();
      const { id, email } = await crearUsuarioPropio(admin, '2fa');

      const sesion = new Sesion(BASE);
      const primerLogin = await sesion.login(email, PASSWORD_E2E);
      expect(primerLogin.status).toBe(200);

      // 1. Enable: no rota la cookie (skipVerificationOnEnable=false en auth.ts),
      //    asi que `sesion` sigue sirviendo para el paso siguiente.
      const enable = await sesion.post(`${PREFIJO}/auth/two-factor/enable`, {
        password: PASSWORD_E2E,
        method: 'totp',
      });
      expect(enable.status).toBe(200);
      const cuerpoEnable = comoRegistro(enable.body);
      expect(cuerpoEnable.method).toBe('totp');
      const secreto = extraerSecretoTotp(comoTexto(cuerpoEnable.totpURI));

      // 2. Verify de confirmacion (con sesion activa, no es un login): marca
      //    twoFactor.verified=true y user.twoFactorEnabled=true, y SI rota la
      //    cookie (crea una sesion nueva y borra la anterior). `sesion` (via
      //    .post) no la captura sola: se comprueba con el admin en su lugar.
      const confirmar = await sesion.post(`${PREFIJO}/auth/two-factor/verify-totp`, { code: totpActual(secreto) });
      expect(confirmar.status).toBe(200);

      const usuarioTrasEnable = await admin.get(`${PREFIJO}/users/${id}`);
      expect(usuarioTrasEnable.status).toBe(200);
      expect(comoBooleano(comoRegistro(comoRegistro(usuarioTrasEnable.body).data).twoFactorEnabled)).toBe(true);

      // 3. Un login normal ahora exige segundo factor: no abre sesion todavia.
      const sesionNueva = new Sesion(BASE);
      const loginConReto = await sesionNueva.login(email, PASSWORD_E2E);
      expect(loginConReto.status).toBe(200);
      const cuerpoReto = comoRegistro(await loginConReto.json());
      expect(cuerpoReto.twoFactorRedirect).toBe(true);

      // 4. Codigo incorrecto -> rechazo. `sesionNueva.login()` ya guardo la
      //    cookie de reto en su jar interno: `.post()` la reenvia sola.
      const codigoMalo = await sesionNueva.post(`${PREFIJO}/auth/two-factor/verify-totp`, { code: '000000' });
      expect(codigoMalo.status).toBe(401);

      // 5. Codigo correcto -> sesion real. Esta respuesta SI rota la cookie:
      //    se usa manualmente para la comprobacion siguiente.
      const codigoBueno = await sesionNueva.post(`${PREFIJO}/auth/two-factor/verify-totp`, {
        code: totpActual(secreto),
      });
      expect(codigoBueno.status).toBe(200);
      const cookieSesionReal = cabeceraCookieDeRespuesta(codigoBueno.headers);
      expect(cookieSesionReal).toContain('session_token');

      const meConSesionReal = await sesionNueva.raw(`${PREFIJO}/users/me`, {
        method: 'GET',
        headers: { Origin: ORIGEN, Cookie: cookieSesionReal },
      });
      expect(meConSesionReal.status).toBe(200);

      // 6. Disable, verificado desde el admin (no depende de cookies rotadas).
      const disable = await sesionNueva.raw(`${PREFIJO}/auth/two-factor/disable`, {
        method: 'POST',
        headers: { Origin: ORIGEN, 'Content-Type': 'application/json', Cookie: cookieSesionReal },
        body: JSON.stringify({ password: PASSWORD_E2E }),
      });
      expect(disable.status).toBe(200);

      const usuarioTrasDisable = await admin.get(`${PREFIJO}/users/${id}`);
      expect(comoBooleano(comoRegistro(comoRegistro(usuarioTrasDisable.body).data).twoFactorEnabled)).toBe(false);
    });
  });

  describe('cuenta suspendida y borrado logico', () => {
    it('suspender corta la sesion abierta (403 ACCOUNT_SUSPENDED) y bloquea un login nuevo; reactivar la restaura', async () => {
      const admin = await iniciarSesionAdmin();
      const { id, email } = await crearUsuarioPropio(admin, 'suspender');

      const sesion = new Sesion(BASE);
      const login = await sesion.login(email, PASSWORD_E2E);
      expect(login.status).toBe(200);
      // La sesion funciona antes de suspender.
      expect((await sesion.get(`${PREFIJO}/users/me`)).status).toBe(200);

      const suspender = await admin.patch(`${PREFIJO}/users/${id}`, { status: 'SUSPENDED' });
      expect(suspender.status).toBe(200);

      const trasSuspender = await sesion.get(`${PREFIJO}/users/me`);
      expect(trasSuspender.status).toBe(403);
      expect(comoTexto(comoRegistro(comoRegistro(trasSuspender.body).error).code)).toBe('ACCOUNT_SUSPENDED');

      const loginSuspendido = await new Sesion(BASE).login(email, PASSWORD_E2E);
      expect(loginSuspendido.status).toBe(401);

      const reactivar = await admin.patch(`${PREFIJO}/users/${id}`, { status: 'ACTIVE' });
      expect(reactivar.status).toBe(200);

      const loginReactivado = await new Sesion(BASE).login(email, PASSWORD_E2E);
      expect(loginReactivado.status).toBe(200);
    });

    it('el borrado logico bloquea el login y el usuario deja de aparecer en GET /users/:id', async () => {
      const admin = await iniciarSesionAdmin();
      const { id, email } = await crearUsuarioPropio(admin, 'borrar');

      const borrar = await admin.delete(`${PREFIJO}/users/${id}`);
      expect(borrar.status).toBe(204);

      const loginBorrado = await new Sesion(BASE).login(email, PASSWORD_E2E);
      expect(loginBorrado.status).toBe(401);

      const verBorrado = await admin.get(`${PREFIJO}/users/${id}`);
      expect(verBorrado.status).toBe(404);
    });
  });
});
