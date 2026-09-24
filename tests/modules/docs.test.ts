import { beforeAll, describe, expect, it } from 'vitest';
import { api, getApp } from '../helpers';

/**
 * `GET /api/v1/docs` (Scalar) y `GET /api/v1/openapi.json` (TC0).
 *
 * La parte que de verdad importa aqui: la CSP propia de `/docs` NO debe
 * filtrarse al resto de la API. Una API JSON no ejecuta scripts; si el
 * permiso a `cdn.jsdelivr.net` se colara a, por ejemplo, `/health`, cualquier
 * XSS en cualquier ruta podria cargar codigo de un tercero.
 */
describe('Documentacion (/docs, /openapi.json)', () => {
  beforeAll(async () => {
    await getApp();
  });

  it('/docs sirve HTML con su propia CSP (script/style de cdn.jsdelivr.net)', async () => {
    const res = await api().get('/api/v1/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('api-reference');
    expect(res.text).toContain('cdn.jsdelivr.net');

    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("script-src 'self' https://cdn.jsdelivr.net");
    expect(csp).toContain('cdn.jsdelivr.net');
  });

  it('el resto de la API conserva la CSP restrictiva de siempre (default-src none, sin jsDelivr)', async () => {
    const res = await api().get('/api/v1/health');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('cdn.jsdelivr.net');
  });

  it('openapi.json: paths/components/securitySchemes y las rutas de Better Auth fusionadas', async () => {
    const res = await api().get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths).toBeTypeOf('object');
    expect(res.body.components).toBeTypeOf('object');

    // Rutas propias.
    expect(res.body.paths['/api/v1/users/me']).toBeDefined();

    // Fusionadas de Better Auth: no hay una copia a mano, se generan en vivo.
    expect(res.body.paths['/api/v1/auth/sign-in/email']).toBeDefined();
    expect(res.body.paths['/api/v1/auth/get-session']).toBeDefined();

    // securitySchemes: cookie (nombre exacto de Better Auth) + bearer.
    const esquemas = res.body.components.securitySchemes;
    expect(esquemas.bearerAuth.type).toBe('http');
    expect(esquemas.cookieAuth).toEqual(
      expect.objectContaining({ type: 'apiKey', in: 'cookie', name: 'better-auth.session_token' }),
    );

    // Nada de /internal en el contrato publico.
    const rutasInternas = Object.keys(res.body.paths).filter((p: string) => p.includes('/internal'));
    expect(rutasInternas).toHaveLength(0);
  });
});
