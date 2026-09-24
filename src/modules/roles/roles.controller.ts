import type { Request, RequestHandler } from 'express';
import { created, noContent, ok, paginated } from '../../core/http/api-response';
import { body, param, requestMeta } from '../../core/http/request';
import { actor } from '../../core/rbac/guards';
import * as service from './roles.service';
import type { CreateRoleInput, ListRolesQuery, UpdateRoleInput } from './roles.schemas';

/** req.query ya viene validado y normalizado por `validate()`. */
function listQuery(req: Request): ListRolesQuery {
  return req.query as unknown as ListRolesQuery;
}

export const list: RequestHandler = async (req, res) => paginated(res, await service.list(listQuery(req)));

export const getById: RequestHandler = async (req, res) => ok(res, await service.getById(param(req, 'id')));

export const create: RequestHandler = async (req, res) =>
  created(res, await service.create(body<CreateRoleInput>(req), actor(req), requestMeta(req)));

export const update: RequestHandler = async (req, res) =>
  ok(res, await service.update(param(req, 'id'), body<UpdateRoleInput>(req), actor(req), requestMeta(req)));

export const remove: RequestHandler = async (req, res) => {
  await service.remove(param(req, 'id'), actor(req), requestMeta(req));
  return noContent(res);
};

export const setPermissions: RequestHandler = async (req, res) =>
  ok(
    res,
    await service.setPermissions(
      param(req, 'id'),
      body<{ permissions: string[] }>(req).permissions,
      actor(req),
      requestMeta(req),
    ),
  );
