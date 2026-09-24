import fs from 'node:fs';
import path from 'node:path';

/**
 * Deriva la base de datos y los puertos de la corrida E2E (T12, E1).
 *
 * Unico punto de esta cuenta: `servidor.ts`, `cliente.ts` y `global-setup.ts`
 * lo importan para no divergir entre si. `E2E_DATABASE`/`E2E_PORT` toman su
 * valor de las variables de entorno (las pone cada tarea de la ola E2 antes de
 * lanzar `npm run test:e2e`) y caen a los valores por defecto de T12 si faltan.
 *
 * `process.loadEnvFile` es stdlib (Node >=20.12): sin dependencias nuevas y
 * sin pisar variables ya presentes en `process.env` (asi un valor puesto a
 * mano antes de arrancar el proceso siempre gana sobre el `.env` del repo).
 */
const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

export const E2E_DATABASE = process.env.E2E_DATABASE?.trim() || 'hospital_e2e';
export const E2E_PORT = Number(process.env.E2E_PORT) || 3200;
/** El puerto interno del agente es siempre el publico + 1 (spec E1). */
export const E2E_INTERNAL_PORT = E2E_PORT + 1;

/**
 * Construye la URL de la BD E2E cambiando SOLO el nombre de la base en el
 * `DATABASE_URL` de `.env`: mismo host, usuario y parametros de conexion.
 */
export function urlBaseDatosE2E(): string {
  const original = process.env.DATABASE_URL;
  if (!original) {
    throw new Error('DATABASE_URL no esta definida: falta el .env del repo o la variable de entorno.');
  }
  const url = new URL(original);
  url.pathname = `/${E2E_DATABASE}`;
  return url.toString();
}
