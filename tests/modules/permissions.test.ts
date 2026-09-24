import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_LIST, WILDCARD_PERMISSION } from '../../src/core/rbac/permissions';
import { api, crearUsuarioConRol, getApp, limpiar, prisma } from '../helpers';

/**
 * `GET /permissions` (T3): catalogo agrupado que alimenta la pantalla de
 * roles. Debe ser EXACTAMENTE `PERMISSION_LIST` (24 entradas): el comodin `*`
 * vive en la tabla `Permission` (el seed lo inserta para poder enlazarlo a
 * SUPER_ADMIN) pero no es un permiso asignable por API, asi que no debe
 * aparecer aqui. Antes del arreglo de `permissions.service.ts#listarAgrupados`
 * este endpoint devolvia 25 filas (incluia el comodin).
 */
describe('Modulo de permisos (T3)', () => {
  beforeAll(async () => {
    await getApp();
    await limpiar();
  });

  afterAll(async () => {
    await limpiar();
    await prisma.$disconnect();
  });

  it('devuelve exactamente el catalogo de PERMISSION_LIST, sin el comodin', async () => {
    const admin = await crearUsuarioConRol('ADMIN');

    const res = await api().get('/api/v1/permissions').set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    const grupos = res.body.data.groups as Array<{ permissions: Array<{ action: string }> }>;
    const acciones = grupos.flatMap((g) => g.permissions.map((p) => p.action));

    expect(res.body.data.total).toBe(PERMISSION_LIST.length);
    expect(acciones).toHaveLength(PERMISSION_LIST.length);
    expect(new Set(acciones)).toEqual(new Set(PERMISSION_LIST.map((p) => p.action)));
    expect(acciones).not.toContain(WILDCARD_PERMISSION);
  });

  it('la tabla Permission SI guarda el comodin (lo usa SUPER_ADMIN), pero el endpoint lo filtra', async () => {
    const admin = await crearUsuarioConRol('ADMIN');

    const filaComodin = await prisma.permission.findUnique({ where: { action: WILDCARD_PERMISSION } });
    expect(filaComodin).not.toBeNull();

    const res = await api().get('/api/v1/permissions').set('Authorization', `Bearer ${admin.token}`);
    const grupos = res.body.data.groups as Array<{ permissions: Array<{ id: string }> }>;
    const ids = grupos.flatMap((g) => g.permissions.map((p) => p.id));
    expect(ids).not.toContain(filaComodin!.id);
  });
});
