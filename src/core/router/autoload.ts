import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Express, Router } from 'express';
import { logger } from '../logger';

/**
 * CARGA DINAMICA DE RUTAS.
 *
 * Convencion: cualquier archivo `*.routes.ts` bajo src/modules se monta solo.
 * El prefijo sale de la carpeta que lo contiene:
 *
 *   modules/users/users.routes.ts        -> {API_PREFIX}/users
 *   modules/admin/roles/roles.routes.ts  -> {API_PREFIX}/admin/roles
 *
 * El archivo exporta el Router por defecto. Para forzar otro prefijo:
 *
 *   export const basePath = '/auth';
 *   export default router;
 *
 * Nunca hay que importar rutas a mano en app.ts.
 */

const ROUTE_FILE = /\.routes\.(ts|js)$/;

export interface RouteModule {
  default?: Router;
  router?: Router;
  basePath?: string;
}

export interface LoadedRoute {
  basePath: string;
  file: string;
}

export interface LoadOptions {
  modulesDir: string;
  prefix: string;
  /** Carpetas que se montan a mano en app.ts (p. ej. health, fuera del rate limit). */
  exclude?: string[];
}

function toBasePath(relativeFile: string): string {
  const dir = path.dirname(relativeFile);
  if (dir === '.') {
    // Archivo suelto en la raiz de modules: usar su propio nombre.
    return `/${path.basename(relativeFile).replace(ROUTE_FILE, '')}`;
  }
  return `/${dir.split(path.sep).join('/')}`;
}

function isRouter(value: unknown): value is Router {
  return typeof value === 'function' && 'stack' in (value as object);
}

export async function loadRoutes(app: Express, options: LoadOptions): Promise<LoadedRoute[]> {
  const root = path.resolve(options.modulesDir);
  if (!fs.existsSync(root)) {
    logger.warn({ root }, 'No existe el directorio de modulos; no se cargaron rutas');
    return [];
  }

  const excluidos = new Set(options.exclude ?? []);

  const files = fs
    .readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => ROUTE_FILE.test(file) && !file.endsWith('.d.ts'))
    .filter((file) => {
      const carpeta = path.dirname(file).split(path.sep)[0];
      return !(carpeta && excluidos.has(carpeta));
    })
    // Orden estable: el mismo mapa de rutas en todos los entornos.
    .sort();

  const loaded: LoadedRoute[] = [];

  for (const file of files) {
    const absolute = path.join(root, file);
    const mod = (await import(pathToFileURL(absolute).href)) as RouteModule;
    const router = mod.default ?? mod.router;

    if (!isRouter(router)) {
      throw new Error(`[autoload] ${file} no exporta un Router de Express (usa "export default router").`);
    }

    const basePath = `${options.prefix}${mod.basePath ?? toBasePath(file)}`;
    app.use(basePath, router);
    loaded.push({ basePath, file });
    logger.debug({ basePath, file }, 'Ruta montada');
  }

  logger.info({ total: loaded.length }, 'Rutas cargadas dinamicamente');
  return loaded;
}
