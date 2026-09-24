import http from 'node:http';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app';
import { importarDirectorio } from '../src/scripts/import-data';

export const prisma = new PrismaClient();

let appCache: Express | null = null;

export async function getApp(): Promise<Express> {
  appCache ??= await createApp();
  return appCache;
}

let servidorCache: http.Server | null = null;

/**
 * Servidor HTTP real, creado una sola vez y reutilizado por `api()`.
 *
 * `supertest`, cuando se le pasa una app de Express "pelada" (una funcion, no
 * un `http.Server`), crea un servidor nuevo y hace `.listen(0)` en un puerto
 * aleatorio en CADA llamada a `.get()/.post()/...` (ver
 * `node_modules/supertest/lib/test.js`, `serverAddress()`), y lo cierra al
 * terminar esa peticion. Con archivos que hacen cientos de peticiones
 * seguidas (la matriz RBAC pasa de 200), ese bind/close constante en
 * `127.0.0.1` es la causa raiz de su intermitencia: de tarde en tarde, dos
 * servidores efimeros seguidos chocan un puerto que el SO aun no libero
 * (TIME_WAIT) y una peticion recibe la respuesta de OTRA -- un 404 de una
 * ruta que no tiene nada que ver, o un login que falla sin motivo aparente.
 * Reutilizar UN solo servidor ya escuchando elimina ese bind/close por
 * peticion: `serverAddress()` solo llama a `.listen(0)` si el servidor
 * TODAVIA no tiene direccion (`!app.address()`), asi que pasarle aqui un
 * `http.Server` ya arrancado hace que las llamadas siguientes lo reutilicen.
 *
 * A proposito NO es `supertest.agent(app)`: ese wrapper ADEMAS guarda y
 * reenvia cookies automaticamente entre peticiones (superagent `Agent`), lo
 * que cambiaria el comportamiento de los tests que hoy dependen de NO llevar
 * ninguna cookie salvo que la pongan a mano (p.ej. "sin sesion -> 401"). Un
 * `http.Server` normal pasado a `request()` no activa ese guardado: sigue
 * siendo el mismo `request(app)` de siempre, solo que sin crear un servidor
 * nuevo en cada llamada. `.unref()` para que un servidor que queda abierto no
 * le impida salir al proceso de test (mismo patron que `core/cache/redis.ts`).
 */
function servidorApi(): http.Server {
  if (!servidorCache) {
    if (!appCache) throw new Error('Llama a getApp() antes de api().');
    servidorCache = http.createServer(appCache);
    servidorCache.listen(0);
    servidorCache.unref();
  }
  return servidorCache;
}

export const api = () => request(servidorApi());

/** Prefijo de las rutas de Better Auth. */
export const AUTH = '/api/v1/auth';

let contador = 0;
export function emailUnico(prefijo = 'u'): string {
  contador += 1;
  return `${prefijo}${Date.now()}${contador}@test.local`;
}

export const PASSWORD = 'ClaveDePrueba123';

export interface UsuarioPrueba {
  id: string;
  email: string;
  token: string;
  roleId?: string;
}

/**
 * Alta por la API de Better Auth, no por Prisma: la contraseña tiene que
 * acabar en `Account.password` con el formato que la libreria sabe verificar.
 * Escribirla a mano daria un usuario que existe y no puede entrar.
 */
export async function registrar(email: string, password = PASSWORD): Promise<string> {
  const res = await api()
    .post(`${AUTH}/sign-up/email`)
    .send({ email, password, name: 'Test' });
  if (res.status !== 200) {
    throw new Error(`Registro fallido para ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  // El correo se marca verificado a mano: en los tests no hay bandeja de entrada.
  await prisma.user.update({ where: { id: id.id }, data: { emailVerified: true } });
  // signUpEmail abre sesion; los tests piden la suya explicitamente con login().
  await prisma.session.deleteMany({ where: { userId: id.id } });
  return id.id;
}

/**
 * Inicia sesion y devuelve el token de sesion.
 *
 * El plugin `bearer` lo expone en la cabecera `set-auth-token`, para clientes
 * que no usan cookies. Es el mismo token que va en la cookie.
 */
export async function login(email: string, password = PASSWORD): Promise<string> {
  const res = await api().post(`${AUTH}/sign-in/email`).send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login fallido para ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const token: string | undefined = res.headers['set-auth-token'];
  if (!token) throw new Error(`Sin cabecera set-auth-token en el login de ${email}`);
  return token;
}

/** Cookie de sesion del login, para los tests que prueban la ruta de cookie. */
export async function loginConCookie(email: string, password = PASSWORD): Promise<string> {
  const res = await api().post(`${AUTH}/sign-in/email`).send({ email, password });
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  const sesion = cookies?.find((c) => c.includes('session_token'));
  if (!sesion) throw new Error(`Sin cookie de sesion en el login de ${email}`);
  return sesion.split(';')[0]!;
}

/**
 * Crea un usuario con EXACTAMENTE los permisos indicados, mediante un rol
 * dedicado. Es la pieza clave de los tests de escalada: permite construir el
 * "administrador delegado" al que la auditoria encontro convertible en superadmin.
 */
export async function crearUsuarioCon(permisos: string[], nombreRol?: string): Promise<UsuarioPrueba> {
  const email = emailUnico('perm');
  contador += 1;
  const rol = nombreRol ?? `rol-test-${Date.now()}-${contador}`;

  const permisosDb = await prisma.permission.findMany({ where: { action: { in: permisos } } });
  if (permisosDb.length !== permisos.length) {
    const faltan = permisos.filter((p) => !permisosDb.some((d) => d.action === p));
    throw new Error(`Permisos no sembrados: ${faltan.join(', ')}. Corre npm run db:seed:dev`);
  }

  const role = await prisma.role.create({
    data: {
      name: rol,
      permissions: { create: permisosDb.map((p) => ({ permissionId: p.id })) },
    },
  });

  const id = await registrar(email);
  // Se reemplaza el rol por defecto que puso el hook de Better Auth.
  await prisma.userRole.deleteMany({ where: { userId: id } });
  await prisma.userRole.create({ data: { userId: id, roleId: role.id } });

  return { id, email, token: await login(email), roleId: role.id };
}

export async function crearUsuarioNormal(): Promise<UsuarioPrueba> {
  const email = emailUnico('normal');
  const id = await registrar(email);
  return { id, email, token: await login(email) };
}

/**
 * Crea un usuario con exactamente un rol de SISTEMA (SUPER_ADMIN, ADMIN,
 * DIRECTOR, JEFE_SERVICIO, FARMACIA, ANALISTA, CONSULTA). A diferencia de
 * `crearUsuarioCon`, que arma un rol ad-hoc a partir de una lista de permisos,
 * esta reutiliza los roles ya sembrados: es la pieza clave de la matriz RBAC
 * (T3, T4, T5), donde lo que se prueba es el rol de negocio, no una
 * combinacion arbitraria de permisos.
 */
export async function crearUsuarioConRol(rol: string): Promise<UsuarioPrueba> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: rol } });
  const email = emailUnico('rol');
  const id = await registrar(email);
  // El hook de Better Auth ya asigno CONSULTA (el rol por defecto): se reemplaza.
  await prisma.userRole.deleteMany({ where: { userId: id } });
  await prisma.userRole.create({ data: { userId: id, roleId: role.id } });

  return { id, email, token: await login(email), roleId: role.id };
}

export async function permisosDe(userId: string): Promise<string[]> {
  const filas = await prisma.userRole.findMany({
    where: { userId },
    select: { role: { select: { permissions: { select: { permission: true } } } } },
  });
  const set = new Set<string>();
  for (const { role } of filas) for (const { permission } of role.permissions) set.add(permission.action);
  return [...set].sort();
}

export async function rolesDe(userId: string): Promise<string[]> {
  const filas = await prisma.userRole.findMany({
    where: { userId },
    select: { role: { select: { name: true } } },
  });
  return filas.map((r) => r.role.name).sort();
}

/** Deja la BD limpia de artefactos de test, sin tocar roles de sistema. */
export async function limpiar(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { contains: '@test.local' } } });
  await prisma.role.deleteMany({ where: { isSystem: false } });
}

/**
 * Vacia las tablas `his_*` y las vuelve a cargar con los fixtures de
 * `tests/fixtures/his` (T6). Borrado en orden hijo -> padre: las FK reales
 * (Admission -> Patient/Triage, ServiceRecord/MedicationDispense -> Admission)
 * impiden borrar en cualquier otro orden.
 */
export async function cargarFixturesHis(): Promise<void> {
  await prisma.$transaction([
    prisma.serviceRecord.deleteMany(),
    prisma.medicationDispense.deleteMany(),
    prisma.surgerySchedule.deleteMany(),
    prisma.medicationStock.deleteMany(),
    prisma.admission.deleteMany(),
    prisma.triage.deleteMany(),
    prisma.patient.deleteMany(),
    prisma.procedure.deleteMany(),
    prisma.medication.deleteMany(),
  ]);
  await importarDirectorio(path.join(__dirname, 'fixtures/his'));
}
