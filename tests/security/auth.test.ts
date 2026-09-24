import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  api,
  AUTH,
  crearUsuarioNormal,
  emailUnico,
  getApp,
  limpiar,
  login,
  loginConCookie,
  prisma,
  registrar,
  PASSWORD,
} from '../helpers';

const ORIGEN_PRUEBA = 'http://localhost:5173';

/** Cookie de sesion (solo el par nombre=valor) de un `set-cookie` con `session_token`. */
function cookieDeSesion(cabeceras: Record<string, unknown>): string {
  const crudas = cabeceras['set-cookie'] as string[] | undefined;
  const sesion = crudas?.find((c) => c.includes('session_token'));
  if (!sesion) throw new Error('Sin cookie de sesion en la respuesta');
  return sesion.split(';')[0]!;
}

/**
 * Autenticacion con Better Auth (solo credenciales) y las defensas del borde.
 *
 * Tras la migracion, tres invariantes propios dejaron de existir a proposito
 * (rotacion CAS del refresh, deteccion de reuso y orden estado-antes-de-
 * contraseña): el modelo de sesion es el de la libreria. Ver CLAUDE.md §15.
 * Lo que SI se sigue exigiendo aqui es lo que no depende de ese modelo.
 */
describe('Autenticacion · Better Auth con credenciales', () => {
  beforeAll(async () => {
    await getApp();
    await limpiar();
  });

  afterAll(async () => {
    await limpiar();
    await prisma.$disconnect();
  });

  describe('Credenciales', () => {
    it('la contraseña se guarda hasheada en Account, nunca en User', async () => {
      const usuario = await crearUsuarioNormal();

      const cuenta = await prisma.account.findFirstOrThrow({
        where: { userId: usuario.id, providerId: 'credential' },
        select: { password: true },
      });

      expect(cuenta.password).toBeTruthy();
      expect(cuenta.password).not.toContain(PASSWORD);
      // Nuestro scrypt con semaforo, enchufado en los hooks de la libreria (C-03).
      expect(cuenta.password!.startsWith('scrypt$')).toBe(true);

      // El usuario publico no expone ningun campo de credencial.
      const me = await api().get('/api/v1/users/me').set('Authorization', `Bearer ${usuario.token}`);
      expect(JSON.stringify(me.body.data)).not.toMatch(/password|scrypt/i);
    });

    it('rechaza la contraseña incorrecta', async () => {
      const usuario = await crearUsuarioNormal();
      const res = await api().post(`${AUTH}/sign-in/email`).send({ email: usuario.email, password: 'OtraClave123' });
      expect(res.status).toBe(401);
    });

    it('exige la politica de contraseñas en el registro', async () => {
      const corta = await api()
        .post(`${AUTH}/sign-up/email`)
        .send({ email: emailUnico('corta'), password: 'abc', name: 'X' });
      expect(corta.status).toBeGreaterThanOrEqual(400);
      expect(await prisma.user.count({ where: { email: { startsWith: 'corta' } } })).toBe(0);
    });
  });

  describe('Sesiones: cookie y Bearer', () => {
    it('acepta las dos vias para la misma cuenta', async () => {
      const usuario = await crearUsuarioNormal();

      const conBearer = await api().get('/api/v1/users/me').set('Authorization', `Bearer ${usuario.token}`);
      expect(conBearer.status).toBe(200);

      const cookie = await loginConCookie(usuario.email);
      const conCookie = await api().get('/api/v1/users/me').set('Cookie', cookie);
      expect(conCookie.status).toBe(200);
      expect(conCookie.body.data.id).toBe(conBearer.body.data.id);
    });

    it('sin credenciales responde 401', async () => {
      const res = await api().get('/api/v1/users/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('un token inventado responde 401', async () => {
      const res = await api().get('/api/v1/users/me').set('Authorization', 'Bearer inventado-no-existe');
      expect(res.status).toBe(401);
    });

    it('cerrar sesion mata el token', async () => {
      const usuario = await crearUsuarioNormal();
      const token = await login(usuario.email);

      expect((await api().get('/api/v1/users/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);

      await api().post(`${AUTH}/sign-out`).set('Authorization', `Bearer ${token}`);

      expect((await api().get('/api/v1/users/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    });

    it('borrar la sesion en BD invalida el acceso en la peticion siguiente', async () => {
      // Sin cache de cookie en tests (SESSION_COOKIE_CACHE_SECONDS=0): una
      // revocacion debe notarse ya. En produccion el desfase es el TTL.
      const usuario = await crearUsuarioNormal();
      await prisma.session.deleteMany({ where: { userId: usuario.id } });
      const res = await api().get('/api/v1/users/me').set('Authorization', `Bearer ${usuario.token}`);
      expect(res.status).toBe(401);
    });
  });

  describe('CSRF por origen', () => {
    it('rechaza una mutacion por cookie SIN cabecera Origin', async () => {
      // La version anterior dejaba pasar la peticion sin Origin (fail-open), que
      // es precisamente la forma del ataque. Ahora cierra en fallo.
      const usuario = await crearUsuarioNormal();
      const cookie = await loginConCookie(usuario.email);

      const res = await api().patch('/api/v1/users/me').set('Cookie', cookie).send({ name: 'Atacante' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rechaza un Origin que no esta en CORS_ORIGINS', async () => {
      const usuario = await crearUsuarioNormal();
      const cookie = await loginConCookie(usuario.email);

      const res = await api()
        .patch('/api/v1/users/me')
        .set('Cookie', cookie)
        .set('Origin', 'https://atacante.example')
        .send({ name: 'Atacante' });

      expect(res.status).toBe(403);
    });

    it('acepta la mutacion por cookie con un Origin permitido', async () => {
      const usuario = await crearUsuarioNormal();
      const cookie = await loginConCookie(usuario.email);

      const res = await api()
        .patch('/api/v1/users/me')
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:5173')
        .send({ name: 'Legitimo' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Legitimo');
    });

    it('NO afecta a un cliente Bearer sin cookies (movil)', async () => {
      // Un cliente que no manda cookies no tiene vector CSRF: exigirle Origin
      // romperia moviles y servicio a servicio sin ganar nada.
      const usuario = await crearUsuarioNormal();

      const res = await api()
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${usuario.token}`)
        .send({ name: 'Desde movil' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Desde movil');
    });

    it('no estorba a los metodos seguros', async () => {
      const usuario = await crearUsuarioNormal();
      const cookie = await loginConCookie(usuario.email);
      expect((await api().get('/api/v1/users/me').set('Cookie', cookie)).status).toBe(200);
    });
  });

  describe('M-01 · enumeracion de cuentas', () => {
    it('un registro duplicado no confirma que la cuenta exista', async () => {
      const email = emailUnico('enum');
      await registrar(email);

      const segundo = await api()
        .post(`${AUTH}/sign-up/email`)
        .send({ email, password: PASSWORD, name: 'B' });

      // Lo esencial: no se crea una segunda cuenta.
      expect(await prisma.user.count({ where: { email } })).toBe(1);
      expect(segundo.status).not.toBe(200);
    });

    it('el reset responde igual exista o no la cuenta', async () => {
      const usuario = await crearUsuarioNormal();

      const existe = await api().post(`${AUTH}/request-password-reset`).send({ email: usuario.email });
      const noExiste = await api().post(`${AUTH}/request-password-reset`).send({ email: 'fantasma@test.local' });

      expect(existe.status).toBe(noExiste.status);
      expect(JSON.stringify(existe.body)).toBe(JSON.stringify(noExiste.body));
    });
  });

  describe('Estado de la cuenta', () => {
    it('una cuenta suspendida no puede abrir sesion nueva', async () => {
      const usuario = await crearUsuarioNormal();
      // El helper ya inicio sesion: se parte de cero para contar con exactitud.
      await prisma.session.deleteMany({ where: { userId: usuario.id } });
      await prisma.user.update({ where: { id: usuario.id }, data: { status: 'SUSPENDED' } });

      const res = await api().post(`${AUTH}/sign-in/email`).send({ email: usuario.email, password: PASSWORD });

      // El hook session.create.before la rechaza: Better Auth no conoce `status`.
      expect(res.status).not.toBe(200);
      expect(await prisma.session.count({ where: { userId: usuario.id } })).toBe(0);

      const rastro = await prisma.auditLog.findFirst({
        where: { action: 'auth.session.rejected', targetId: usuario.id },
      });
      expect(rastro).not.toBeNull();
    });

    it('un borrado logico no puede abrir sesion', async () => {
      const usuario = await crearUsuarioNormal();
      await prisma.user.update({
        where: { id: usuario.id },
        data: { status: 'DELETED', deletedAt: new Date() },
      });

      const res = await api().post(`${AUTH}/sign-in/email`).send({ email: usuario.email, password: PASSWORD });
      expect(res.status).not.toBe(200);
    });
  });

  describe('M-04 · cabeceras de cache', () => {
    it('las respuestas de auth llevan Cache-Control: no-store', async () => {
      const usuario = await crearUsuarioNormal();
      const res = await api().post(`${AUTH}/sign-in/email`).send({ email: usuario.email, password: PASSWORD });
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('los modulos con datos personales tambien', async () => {
      const usuario = await crearUsuarioNormal();
      for (const ruta of ['/api/v1/users/me', '/api/v1/roles', '/api/v1/permissions', '/api/v1/audit']) {
        const res = await api().get(ruta).set('Authorization', `Bearer ${usuario.token}`);
        expect(res.headers['cache-control'], ruta).toContain('no-store');
      }
    });
  });

  describe('M-05 · X-Request-Id del cliente', () => {
    it('no se refleja tal cual: el servidor genera el suyo', async () => {
      const inyectado = 'atacante-fabrica-esta-traza';
      const res = await api().get('/api/v1/health').set('X-Request-Id', inyectado);

      expect(res.headers['x-request-id']).not.toBe(inyectado);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('Segundo factor', () => {
    it('el plugin twoFactor trae bloqueo por fuerza bruta', async () => {
      // La implementacion anterior auditaba el fallo y no contaba nada: solo la
      // acotaba un rate limit por IP (auditoria A-16). El modelo del plugin
      // lleva contador y bloqueo por cuenta.
      const columnas = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'two_factors'`;
      const nombres = columnas.map((c) => c.column_name);
      expect(nombres).toContain('failedVerificationCount');
      expect(nombres).toContain('lockedUntil');
    });

    it('el estado de 2FA sale en el perfil y arranca desactivado', async () => {
      const usuario = await crearUsuarioNormal();
      const res = await api().get('/api/v1/users/me').set('Authorization', `Bearer ${usuario.token}`);
      expect(res.body.data.twoFactorEnabled).toBe(false);
    });
  });

  describe('T1 · Content-Type y auditoria del logout', () => {
    it('un body no-JSON en una mutacion responde 415 UNSUPPORTED_MEDIA_TYPE', async () => {
      // requireJson corre antes de cualquier ruta (incluso antes de authenticate),
      // asi que ni siquiera hace falta una sesion para llegar al 415.
      const res = await api().post('/api/v1/users').type('text/plain').send('cuerpo-no-json');

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('POST /auth/sign-out deja una fila auth.logout', async () => {
      // Hoy el logout no se auditaba: la sesion se lee en hooks.before ANTES
      // de que el propio endpoint la destruya.
      const usuario = await crearUsuarioNormal();
      const token = await login(usuario.email);

      await api().post(`${AUTH}/sign-out`).set('Authorization', `Bearer ${token}`);

      const rastro = await prisma.auditLog.findFirst({
        where: { action: 'auth.logout', targetId: usuario.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(rastro).not.toBeNull();
    });
  });

  /**
   * `tests/setup.ts` fija `SESSION_COOKIE_CACHE_SECONDS=0` para que el resto de
   * la suite vea siempre el estado real de la BD. Ese valor por defecto NO
   * ejercita `disableCookieCache` en `authenticate.ts` (con cache=0, Better
   * Auth ya iba a la BD de todos modos), asi que aqui se activa la cache
   * LOCALMENTE, solo para este test: se sube `SESSION_COOKIE_CACHE_SECONDS`,
   * se resetea el registro de modulos de Vitest (`vi.resetModules()`) y se
   * crea una app nueva para que `core/auth/auth.ts` la lea de nuevo al
   * construir su config. La cobertura equivalente en caliente, contra el
   * proceso real arrancado como hijo, esta en
   * `tests/e2e/auth.e2e.test.ts` (describe "logout").
   */
  describe('SESSION_COOKIE_CACHE_SECONDS activo: authenticate no debe usar la cache', () => {
    it('una cookie de sesion reenviada tras logout sigue dando 401 con la cache de cookie activada', async () => {
      const valorPrevio = process.env.SESSION_COOKIE_CACHE_SECONDS;
      process.env.SESSION_COOKIE_CACHE_SECONDS = '60';
      vi.resetModules();

      let appConCache: Express | undefined;
      try {
        const { createApp } = await import('../../src/app');
        appConCache = await createApp();
        const cliente = request(appConCache);

        const email = emailUnico('cachecookie');
        const alta = await cliente
          .post(`${AUTH}/sign-up/email`)
          .set('Origin', ORIGEN_PRUEBA)
          .send({ email, password: PASSWORD, name: 'Cache cookie' });
        expect(alta.status).toBe(200);
        await prisma.user.update({ where: { email }, data: { emailVerified: true } });
        // El alta abre su propia sesion: se descarta para partir de un login limpio.
        const { id: userId } = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
        await prisma.session.deleteMany({ where: { userId } });

        const entrada = await cliente
          .post(`${AUTH}/sign-in/email`)
          .set('Origin', ORIGEN_PRUEBA)
          .send({ email, password: PASSWORD });
        expect(entrada.status).toBe(200);
        const cookie = cookieDeSesion(entrada.headers);

        const salida = await cliente.post(`${AUTH}/sign-out`).set('Origin', ORIGEN_PRUEBA).set('Cookie', cookie);
        expect(salida.status).toBe(200);

        // Misma cookie, "robada y repetida" tras el logout: con la cache de
        // cookie activada y sin `disableCookieCache`, esto respondia 200.
        const repetida = await cliente.get('/api/v1/users/me').set('Cookie', cookie);
        expect(repetida.status).toBe(401);
      } finally {
        if (valorPrevio === undefined) delete process.env.SESSION_COOKIE_CACHE_SECONDS;
        else process.env.SESSION_COOKIE_CACHE_SECONDS = valorPrevio;
        vi.resetModules();
      }
    });
  });

  describe('Superficie expuesta', () => {
    it('Better Auth documenta sus propias rutas', async () => {
      expect((await api().get(`${AUTH}/reference`)).status).toBe(200);
    });

    it('una ruta inexistente responde con el contrato de error estandar', async () => {
      const res = await api().get('/api/v1/no-existe');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.meta.requestId).toBeTruthy();
    });
  });
});
