import { PrismaClient } from '@prisma/client';
import { env } from '../../src/config/env';
import { PASSWORD_POLICY } from '../../src/core/security/password';
import { urlBaseDatosE2E } from './entorno';

/**
 * Cliente E2E minimo sobre `fetch`. Nada de supertest ni de la app en
 * memoria (E0): habla HTTP de verdad con el proceso real, con cookies y
 * cabecera `Origin` como un navegador.
 */

/** Origen "de navegador" para las peticiones. Debe estar en CORS_ORIGINS (`.env`). */
export const ORIGEN = 'http://localhost:5173';

const PREFIJO = env.API_PREFIX;

export interface Respuesta {
  status: number;
  headers: Headers;
  /** JSON parseado si el cuerpo lo era; texto crudo en caso contrario; null sin cuerpo. */
  body: unknown;
}

async function leerCuerpo(respuesta: Response): Promise<unknown> {
  const texto = await respuesta.text();
  if (texto === '') return null;
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return texto;
  }
}

/** Aplica los pares `nombre=valor` de una o mas cabeceras Set-Cookie, como hace un navegador. */
function aplicarSetCookie(guardadas: Map<string, string>, setCookie: string[]): void {
  for (const cadena of setCookie) {
    const par = cadena.split(';', 1)[0] ?? '';
    const igual = par.indexOf('=');
    if (igual === -1) continue;
    guardadas.set(par.slice(0, igual), par.slice(igual + 1));
  }
}

/**
 * Una instancia por usuario: guarda su cookie de sesion como lo haria un
 * navegador y la reenvia en cada peticion junto a `Origin`.
 */
export class Sesion {
  private readonly cookies = new Map<string, string>();
  /** Cabecera `set-auth-token` del ultimo login: sirve como `Authorization: Bearer`. */
  token: string | undefined;

  constructor(private readonly base: string) {}

  private cabeceraCookie(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies].map(([nombre, valor]) => `${nombre}=${valor}`).join('; ');
  }

  /** Peticion cruda: NO añade Origin, cookie ni Content-Type. Para probar CSRF/415/CORS a mano. */
  async raw(ruta: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.base}${ruta}`, init);
  }

  private async peticion(metodo: string, ruta: string, body?: unknown): Promise<Respuesta> {
    const cookie = this.cabeceraCookie();
    const headers: Record<string, string> = { Origin: ORIGEN };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;

    const respuesta = await this.raw(ruta, {
      method: metodo,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: respuesta.status, headers: respuesta.headers, body: await leerCuerpo(respuesta) };
  }

  /** POST /auth/sign-in/email. Guarda la cookie de sesion y el token Bearer para las peticiones siguientes. */
  async login(email: string, password: string): Promise<Response> {
    const respuesta = await this.raw(`${PREFIJO}/auth/sign-in/email`, {
      method: 'POST',
      headers: { Origin: ORIGEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    aplicarSetCookie(this.cookies, respuesta.headers.getSetCookie());
    this.token = respuesta.headers.get('set-auth-token') ?? this.token;
    return respuesta;
  }

  get(ruta: string): Promise<Respuesta> {
    return this.peticion('GET', ruta);
  }
  post(ruta: string, body?: unknown): Promise<Respuesta> {
    return this.peticion('POST', ruta, body);
  }
  put(ruta: string, body?: unknown): Promise<Respuesta> {
    return this.peticion('PUT', ruta, body);
  }
  patch(ruta: string, body?: unknown): Promise<Respuesta> {
    return this.peticion('PATCH', ruta, body);
  }
  delete(ruta: string, body?: unknown): Promise<Respuesta> {
    return this.peticion('DELETE', ruta, body);
  }
}

/** Credenciales de los usuarios sembrados, tomadas de `.env` (SEED_*) o de los valores por defecto de `env.ts`. */
export const credenciales = {
  superadmin: { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD },
  director: { email: env.SEED_DIRECTOR_EMAIL, password: env.SEED_TEST_PASSWORD },
  farmacia: { email: env.SEED_FARMACIA_EMAIL, password: env.SEED_TEST_PASSWORD },
};

let contadorCorreo = 0;
/** Correo unico por corrida: `e2e-<ts>-<n>@e2e.test` (E0: nunca colisiona entre relanzamientos). */
export function emailUnico(): string {
  contadorCorreo += 1;
  return `e2e-${Date.now()}-${contadorCorreo}@e2e.test`;
}

/**
 * Contraseña fija que cumple `PASSWORD_POLICY` (12+ caracteres, mayuscula,
 * minuscula y digito) y no contiene el usuario local de ningun correo
 * `emailUnico()` (que solo lleva "e2e", digitos y guiones): createUserSchema
 * rechaza una contraseña que SI lo contenga.
 */
const PASSWORD_USUARIO_E2E = 'HospitalIntel2026!Segura';
if (PASSWORD_USUARIO_E2E.length < PASSWORD_POLICY.minLength) {
  throw new Error('PASSWORD_USUARIO_E2E no cumple PASSWORD_POLICY.minLength');
}

/**
 * Crea (via el superadmin sembrado y `POST /users`) un usuario `@e2e.test`
 * con exactamente el rol de sistema indicado, y devuelve su sesion ya
 * autenticada. Es la pieza clave para ejercitar la API "como" cada rol.
 */
export async function comoRol(base: string, rol: string): Promise<Sesion> {
  const admin = new Sesion(base);
  const loginAdmin = await admin.login(credenciales.superadmin.email, credenciales.superadmin.password);
  if (loginAdmin.status !== 200) {
    throw new Error(`No se pudo iniciar sesion como superadmin (${loginAdmin.status}).`);
  }

  const email = emailUnico();
  const creado = await admin.post(`${PREFIJO}/users`, {
    email,
    password: PASSWORD_USUARIO_E2E,
    name: `E2E ${rol}`,
    roles: [rol],
  });
  if (creado.status !== 201) {
    throw new Error(`No se pudo crear el usuario e2e con rol ${rol}: ${creado.status} ${JSON.stringify(creado.body)}`);
  }

  const sesion = new Sesion(base);
  const login = await sesion.login(email, PASSWORD_USUARIO_E2E);
  if (login.status !== 200) {
    throw new Error(`No se pudo iniciar sesion con el usuario e2e recien creado (${email}): ${login.status}`);
  }
  return sesion;
}

let clientePrisma: PrismaClient | undefined;

/** Cliente Prisma propio contra la BD E2E, para cotejar cifras con una consulta independiente (E0). */
export function prismaE2E(): PrismaClient {
  clientePrisma ??= new PrismaClient({ datasources: { db: { url: urlBaseDatosE2E() } } });
  return clientePrisma;
}
