import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, crearUsuarioConRol, getApp, limpiar, prisma } from '../helpers';

/** TC5: `GET /audit/:id` (detalle), con el mismo DTO que el listado. */
describe('GET /api/v1/audit/:id', () => {
  beforeAll(async () => {
    await getApp();
    await limpiar();
  });

  afterAll(async () => {
    await limpiar();
    await prisma.$disconnect();
  });

  it('401 sin sesion', async () => {
    const res = await api().get(`/api/v1/audit/${randomUUID()}`);
    expect(res.status).toBe(401);
  });

  it('403 para FARMACIA, que no tiene audit:read', async () => {
    const usuario = await crearUsuarioConRol('FARMACIA');
    const res = await api().get(`/api/v1/audit/${randomUUID()}`).set('Authorization', `Bearer ${usuario.token}`);
    expect(res.status).toBe(403);
  });

  it('un id con formato invalido (no uuid) responde 422', async () => {
    const usuario = await crearUsuarioConRol('ADMIN');
    const res = await api().get('/api/v1/audit/no-es-un-uuid').set('Authorization', `Bearer ${usuario.token}`);
    expect(res.status).toBe(422);
  });

  it('un uuid valido pero inexistente responde 404', async () => {
    const usuario = await crearUsuarioConRol('ADMIN');
    const res = await api().get(`/api/v1/audit/${randomUUID()}`).set('Authorization', `Bearer ${usuario.token}`);
    expect(res.status).toBe(404);
  });

  it('200 con el mismo DTO que el listado', async () => {
    const usuario = await crearUsuarioConRol('ADMIN');
    const fila = await prisma.auditLog.create({
      data: {
        action: 'test.audit.detail',
        actorId: usuario.id,
        actorEmail: usuario.email,
        targetType: 'test',
        targetId: randomUUID(),
        metadata: { motivo: 'fila de prueba para GET /audit/:id' },
      },
    });

    const res = await api().get(`/api/v1/audit/${fila.id}`).set('Authorization', `Bearer ${usuario.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: fila.id,
      action: 'test.audit.detail',
      actorId: usuario.id,
      targetType: 'test',
      targetId: fila.targetId,
      metadata: { motivo: 'fila de prueba para GET /audit/:id' },
    });
    expect(typeof res.body.data.createdAt).toBe('string');
    // No expone userAgent (audit.service.ts): igual que el listado.
    expect(res.body.data.userAgent).toBeUndefined();
  });

  it('la respuesta lleva Cache-Control: no-store', async () => {
    const usuario = await crearUsuarioConRol('ADMIN');
    const res = await api().get(`/api/v1/audit/${randomUUID()}`).set('Authorization', `Bearer ${usuario.token}`);
    expect(res.headers['cache-control']).toContain('no-store');
  });
});
