import { describe, expect, it } from 'vitest';
import { hashPassword, necesitaRehash, verifyPassword, esPasswordComun } from '../../src/core/security/password';
import { requirePermissions, requireRoles } from '../../src/core/middleware/authorize';
import { PERMISSIONS, PERMISSION_LIST, WILDCARD_PERMISSION } from '../../src/core/rbac/permissions';
import { urlSegura } from '../../src/core/http/schemas';
import { templates } from '../../src/core/mail/templates';
import { construirOpenApi } from '../../src/core/openapi/openapi';

describe('Contraseñas', () => {
  it('el hash no filtra el texto plano y verifica correctamente', async () => {
    const hash = await hashPassword('Contraseña-Segura1');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('Contraseña');
    expect(await verifyPassword('Contraseña-Segura1', hash)).toBe(true);
    expect(await verifyPassword('Contraseña-Segura2', hash)).toBe(false);
  });

  it('usa sal distinta en cada hash', async () => {
    expect(await hashPassword('igual')).not.toBe(await hashPassword('igual'));
  });

  it('devuelve false sin hash guardado', async () => {
    expect(await verifyPassword('lo-que-sea', null)).toBe(false);
  });

  it('sigue validando hashes con los parametros antiguos', async () => {
    // Formato generado con N=2^16, r=8, p=1 antes de la recalibracion (C-03).
    const antiguo =
      'scrypt$65536$8$1$' +
      Buffer.from('0123456789abcdef').toString('base64') +
      '$' +
      Buffer.from('x'.repeat(64)).toString('base64');
    expect(await verifyPassword('cualquiera', antiguo)).toBe(false); // no casa, pero NO revienta
    expect(necesitaRehash(antiguo)).toBe(true);
  });

  it('rechaza un hash manipulado con N absurdo sin agotar memoria', async () => {
    const malicioso = `scrypt$999999999$8$1$${Buffer.from('sal').toString('base64')}$${Buffer.from('h').toString('base64')}`;
    expect(await verifyPassword('x', malicioso)).toBe(false);
  });

  it('el filtro local de contraseñas comunes sigue activo', () => {
    // Red previa a HaveIBeenPwned: responde sin salir a la red.
    expect(esPasswordComun('password123')).toBe(true);
    expect(esPasswordComun('PassWord123')).toBe(true);
    expect(esPasswordComun('una-clave-rara-y-larga-42')).toBe(false);
  });
});

describe('RBAC · middleware', () => {
  const ejecutar = (mw: ReturnType<typeof requirePermissions>, permisos: string[], roles: string[] = []) => {
    let error: unknown = null;
    const req = { auth: { id: 'u1', permissions: new Set(permisos), roles } };
    mw(req as never, {} as never, ((e?: unknown) => {
      error = e ?? null;
    }) as never);
    return error;
  };

  it('deja pasar con el permiso y bloquea sin el', () => {
    const mw = requirePermissions(PERMISSIONS.users.read);
    expect(ejecutar(mw, [PERMISSIONS.users.read])).toBeNull();
    expect(ejecutar(mw, [])).toBeTruthy();
    expect(ejecutar(mw, [PERMISSIONS.users.create])).toBeTruthy();
  });

  it('el comodin pasa cualquier chequeo', () => {
    expect(ejecutar(requirePermissions(PERMISSIONS.users.delete), [WILDCARD_PERMISSION])).toBeNull();
  });

  it('mode all exige todos; mode any basta con uno', () => {
    const todos = requirePermissions([PERMISSIONS.users.read, PERMISSIONS.users.update]);
    expect(ejecutar(todos, [PERMISSIONS.users.read])).toBeTruthy();
    expect(ejecutar(todos, [PERMISSIONS.users.read, PERMISSIONS.users.update])).toBeNull();

    const alguno = requirePermissions([PERMISSIONS.users.read, PERMISSIONS.users.update], { mode: 'any' });
    expect(ejecutar(alguno, [PERMISSIONS.users.update])).toBeNull();
    expect(ejecutar(alguno, [PERMISSIONS.roles.read])).toBeTruthy();
  });

  it('sin autenticar nunca se cuela', () => {
    let error: unknown = null;
    requirePermissions(PERMISSIONS.users.read)({} as never, {} as never, ((e?: unknown) => {
      error = e ?? null;
    }) as never);
    expect(error).toBeTruthy();
  });

  it('requireRoles funciona por nombre de rol', () => {
    expect(ejecutar(requireRoles('ADMIN'), [], ['ADMIN'])).toBeNull();
    expect(ejecutar(requireRoles('ADMIN'), [], ['CONSULTA'])).toBeTruthy();
  });
});

describe('Catalogo de permisos', () => {
  it('todos cumplen el formato recurso:accion', () => {
    // El mismo formato lo exige un CHECK en la BD: si esto pasa y el seed
    // falla, el catalogo y la migracion se han desincronizado.
    for (const p of PERMISSION_LIST) expect(p.action).toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/);
  });

  it('no hay duplicados', () => {
    expect(new Set(PERMISSION_LIST.map((p) => p.action)).size).toBe(PERMISSION_LIST.length);
  });
});

describe('urlSegura', () => {
  it.each(['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'http://127.0.0.1/', 'http://169.254.169.254/'])(
    'rechaza %s',
    (url) => {
      expect(urlSegura.safeParse(url).success).toBe(false);
    },
  );

  it('acepta https publica', () => {
    expect(urlSegura.safeParse('https://cdn.example.com/a.png').success).toBe(true);
  });
});

describe('Plantillas de correo', () => {
  it('escapan los datos del usuario y conservan el enlace', () => {
    const mail = templates.verifyEmail({
      name: '<script>alert(1)</script>',
      url: 'https://x.test/y?t=1',
      expiresInHours: 24,
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('https://x.test/y?t=1');
    expect(mail.text.length).toBeGreaterThan(0);
    expect(mail.subject.length).toBeGreaterThan(0);
  });

  it('todas devuelven subject, html y text', () => {
    const todas = [
      templates.welcome({ name: 'A', loginUrl: 'https://x.test' }),
      templates.resetPassword({ name: 'A', url: 'https://x.test', expiresInMinutes: 30 }),
      templates.securityAlert({ name: 'A', title: 'T', message: 'M' }),
      templates.mfaCambiada({ name: 'A', activada: true, codigosRestantes: 10 }),
    ];
    for (const t of todas) {
      expect(t.subject).toBeTruthy();
      expect(t.html).toContain('<!DOCTYPE html>');
      expect(t.text).toBeTruthy();
    }
  });
});

describe('OpenAPI', () => {
  it('se genera desde los schemas de Zod sin romperse', () => {
    const spec = construirOpenApi() as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toBe('3.1.0');
    // 12 rutas unicas: varios metodos comparten path y se agrupan en una.
    expect(Object.keys(spec.paths).length).toBeGreaterThanOrEqual(12);
    expect(spec.paths['/api/v1/users/{id}/roles']).toBeDefined();
    expect(spec.paths['/api/v1/audit']).toBeDefined();
  });

  it('NO documenta a mano las rutas de Better Auth', () => {
    // Las sirve la libreria y las documenta su plugin openAPI. Copiarlas aqui
    // garantizaria que el contrato miente el dia que la libreria cambie.
    const spec = construirOpenApi() as { paths: Record<string, unknown> };
    const deAuth = Object.keys(spec.paths).filter((p) => p.includes('/auth/'));
    expect(deAuth).toHaveLength(0);
  });

  it('incluye /alerts y /assistant/query (T3/T4, ya montados)', () => {
    const spec = construirOpenApi() as { paths: Record<string, unknown> };
    expect(spec.paths['/api/v1/alerts']).toBeDefined();
    expect(spec.paths['/api/v1/alerts/{id}']).toBeDefined();
    expect(spec.paths['/api/v1/assistant/query']).toBeDefined();
  });

  // Una fila por ruta en vez de un solo test con 15 aserciones: mas facil de
  // leer el fallo (que ruta falta) y evita el aviso de complejidad de eslint.
  const RUTAS_HIS_Y_ALERTAS: Array<[metodo: string, path: string]> = [
    ['get', '/api/v1/dashboard/summary'], // T8
    ['get', '/api/v1/dashboard/occupancy'],
    ['get', '/api/v1/dashboard/wait-times'],
    ['get', '/api/v1/dashboard/demand'],
    ['get', '/api/v1/analytics/services'],
    ['get', '/api/v1/analytics/triage'],
    ['get', '/api/v1/analytics/services/export'],
    ['get', '/api/v1/analytics/triage/export'],
    ['get', '/api/v1/analytics/surgeries'], // T9
    ['get', '/api/v1/analytics/surgeries/export'],
    ['get', '/api/v1/medications'],
    ['get', '/api/v1/medications/critical'],
    ['get', '/api/v1/medications/consumption'],
    ['put', '/api/v1/medications/{code}/stock'],
    ['post', '/api/v1/alerts/evaluate'], // T11
  ];

  it.each(RUTAS_HIS_Y_ALERTAS)('incluye %s %s (T8/T9/T11)', (metodo, path) => {
    const spec = construirOpenApi() as { paths: Record<string, Record<string, unknown>> };
    expect(spec.paths[path]?.[metodo]).toBeDefined();
  });

  it('NO documenta la API interna del agente: no es publica', () => {
    // /internal/agent vive en el segundo puerto (internal-app.ts) y nunca pasa
    // por el autoload del publico: no debe aparecer en el contrato publico.
    const spec = construirOpenApi() as { paths: Record<string, unknown> };
    const deInterno = Object.keys(spec.paths).filter((p) => p.includes('/internal'));
    expect(deInterno).toHaveLength(0);
  });
});
