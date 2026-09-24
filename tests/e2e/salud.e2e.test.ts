import { describe, expect, inject, it } from 'vitest';
import { env } from '../../src/config/env';
import { registroOpenApi } from '../../src/core/openapi/registry';
import { ORIGEN, Sesion } from './cliente';

/**
 * Spec de humo (T12): demuestra que la infraestructura E1 funciona de
 * verdad -- servidor real, dos puertos, cabeceras de seguridad, CORS, 404 con
 * el sobre estandar y el contrato OpenAPI -- antes de que el resto de tareas
 * (T13-T16) construyan encima.
 *
 * E0: nada de supertest ni de `createApp()` en memoria. Todo aqui habla HTTP
 * de verdad contra el proceso que arranco `global-setup.ts`.
 */

const BASE = inject('e2eUrl');
const INTERNAL_BASE = inject('e2eInternalUrl');
const PREFIJO = env.API_PREFIX;

/** Estrecha un JSON `unknown` a objeto indexable, sin usar `any` (CLAUDE.md §11). */
function comoRegistro(valor: unknown): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null) {
    throw new Error(`Se esperaba un objeto JSON; se recibio: ${JSON.stringify(valor)}`);
  }
  return valor as Record<string, unknown>;
}

function comoArregloDeTextos(valor: unknown): string[] {
  if (!Array.isArray(valor) || !valor.every((v): v is string => typeof v === 'string')) {
    throw new Error(`Se esperaba un arreglo de strings; se recibio: ${JSON.stringify(valor)}`);
  }
  return valor;
}

function comoNumero(valor: unknown): number {
  if (typeof valor !== 'number') throw new Error(`Se esperaba un numero; se recibio: ${JSON.stringify(valor)}`);
  return valor;
}

describe('salud y plataforma (T12)', () => {
  describe('sondas de salud', () => {
    it('GET /health responde 200 con uptime, sin tocar dependencias', async () => {
      const sesion = new Sesion(BASE);
      const r = await sesion.get(`${PREFIJO}/health`);
      expect(r.status).toBe(200);

      const data = comoRegistro(comoRegistro(r.body).data);
      expect(data.status).toBe('ok');
      expect(comoNumero(data.uptime)).toBeGreaterThanOrEqual(0);
    });

    it('GET /health/ready comprueba la BD, y reporta Redis y el agente como no configurados', async () => {
      const sesion = new Sesion(BASE);
      const r = await sesion.get(`${PREFIJO}/health/ready`);
      expect(r.status).toBe(200);

      const data = comoRegistro(r.body).data;
      const checks = comoRegistro(comoRegistro(data).checks);
      // Sin REDIS_URL (no hay Redis local) y sin AGENT_URL (chat fuera de alcance, E0).
      expect(checks.database).toBe('up');
      expect(checks.redis).toBe('no configurado');
      expect(checks.agent).toBe('no configurado');
    });

    it('GET /health/startup responde 200', async () => {
      const sesion = new Sesion(BASE);
      const r = await sesion.get(`${PREFIJO}/health/startup`);
      expect(r.status).toBe(200);
      expect(comoRegistro(comoRegistro(r.body).data).status).toBe('started');
    });
  });

  describe('indice y contrato OpenAPI', () => {
    it('GET /api/v1 lista los modulos publicos montados y ninguna ruta /internal', async () => {
      const sesion = new Sesion(BASE);
      const r = await sesion.get(PREFIJO);
      expect(r.status).toBe(200);

      const data = comoRegistro(r.body).data;
      const endpoints = comoArregloDeTextos(comoRegistro(data).endpoints);
      expect(endpoints.length).toBeGreaterThan(0);
      expect(endpoints).toContain(`${PREFIJO}/health`);
      for (const ruta of endpoints) {
        expect(ruta.startsWith(PREFIJO)).toBe(true);
        expect(ruta).not.toContain('/internal');
      }
    });

    it('GET /api/v1/openapi.json contiene TODAS las rutas publicas de registry.ts y ninguna /internal', async () => {
      const sesion = new Sesion(BASE);
      const r = await sesion.get(`${PREFIJO}/openapi.json`);
      expect(r.status).toBe(200);

      const cuerpo = comoRegistro(r.body);
      expect(cuerpo.openapi).toBe('3.1.0');
      const paths = comoRegistro(cuerpo.paths);

      // Fuente de verdad: el MISMO registro que consume construirOpenApi(), no
      // una lista copiada a mano que pudiera desincronizarse.
      for (const ruta of registroOpenApi) {
        const clave = `${PREFIJO}${ruta.path.replace(/:(\w+)/g, '{$1}')}`;
        const operaciones = paths[clave];
        expect(operaciones, `falta la ruta ${clave} en openapi.json`).toBeDefined();
        const operacion = comoRegistro(operaciones)[ruta.method];
        expect(operacion, `falta el metodo ${ruta.method.toUpperCase()} ${clave} en openapi.json`).toBeDefined();
      }

      for (const clave of Object.keys(paths)) {
        expect(clave).not.toContain('/internal');
      }
    });
  });

  describe('404 y cabeceras', () => {
    it('una ruta inexistente responde 404 con el sobre de error estandar', async () => {
      const sesion = new Sesion(BASE);
      const r = await sesion.get(`${PREFIJO}/esto-no-existe-${Date.now()}`);
      expect(r.status).toBe(404);

      const cuerpo = comoRegistro(r.body);
      expect(cuerpo.success).toBe(false);
      const error = comoRegistro(cuerpo.error);
      expect(error.code).toBe('NOT_FOUND');
      expect(typeof error.message).toBe('string');
      const meta = comoRegistro(cuerpo.meta);
      expect(typeof meta.requestId).toBe('string');
      expect((meta.requestId as string).length).toBeGreaterThan(0);

      // El id del sobre y el de la cabecera son el mismo (misma peticion).
      expect(r.headers.get('x-request-id')).toBe(meta.requestId);
    });

    it('toda respuesta lleva X-Request-Id y las cabeceras de seguridad esperadas', async () => {
      const sesion = new Sesion(BASE);
      const r = await sesion.get(`${PREFIJO}/health`);
      expect(r.headers.get('x-request-id')).toBeTruthy();
      expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('referrer-policy')).toBe('no-referrer');
      expect(r.headers.get('x-powered-by')).toBeNull();
    });

    it('Cache-Control: no-store en una ruta con datos personales', async () => {
      // Sin sesion: 401, pero `noStore` (antes de `authenticate` en users.routes.ts)
      // ya puso la cabecera. No hace falta autenticarse para comprobarla.
      const sesion = new Sesion(BASE);
      const r = await sesion.get(`${PREFIJO}/users/me`);
      expect(r.status).toBe(401);
      expect(r.headers.get('cache-control')).toContain('no-store');
    });
  });

  describe('CORS', () => {
    it('preflight desde un origen permitido trae Allow-Origin y Allow-Credentials', async () => {
      const respuesta = await fetch(`${BASE}${PREFIJO}/users`, {
        method: 'OPTIONS',
        headers: { Origin: ORIGEN, 'Access-Control-Request-Method': 'GET' },
      });
      expect(respuesta.headers.get('access-control-allow-origin')).toBe(ORIGEN);
      expect(respuesta.headers.get('access-control-allow-credentials')).toBe('true');
    });

    it('preflight desde un origen no permitido no trae Allow-Origin', async () => {
      const respuesta = await fetch(`${BASE}${PREFIJO}/users`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
      });
      expect(respuesta.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('separacion de los dos puertos', () => {
    it('el puerto publico NO sirve /internal/agent/query (404)', async () => {
      const respuesta = await fetch(`${BASE}/internal/agent/query`, { method: 'POST' });
      expect(respuesta.status).toBe(404);
      const cuerpo = comoRegistro(await respuesta.json());
      expect(cuerpo.success).toBe(false);
      expect(comoRegistro(cuerpo.error).code).toBe('NOT_FOUND');
    });

    it('el puerto interno sin X-Internal-Key responde 401', async () => {
      const respuesta = await fetch(`${INTERNAL_BASE}/internal/agent/query`, { method: 'POST' });
      expect(respuesta.status).toBe(401);
    });
  });
});
