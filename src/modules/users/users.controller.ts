import type { Request, RequestHandler } from 'express';
import { created, noContent, ok, paginated } from '../../core/http/api-response';
import { body, param, requestMeta } from '../../core/http/request';
import { actor } from '../../core/rbac/guards';
import * as service from './users.service';
import type { CreateUserInput, ListUsersQuery, UpdateMeInput, UpdateUserInput } from './users.schemas';

/**
 * `validate()` ya sustituyo req.query por la salida tipada de Zod, pero
 * @types/express la declara como ParsedQs. Este helper documenta el contrato en
 * un solo sitio en vez de esparcir `as never` por los controladores (B-01).
 */
function listQuery(req: Request): ListUsersQuery {
  return req.query as unknown as ListUsersQuery;
}

export const list: RequestHandler = async (req, res) => paginated(res, await service.list(listQuery(req)));

export const getById: RequestHandler = async (req, res) => ok(res, await service.getById(param(req, 'id')));

export const getMe: RequestHandler = async (req, res) => ok(res, await service.getById(req.auth!.id));

export const create: RequestHandler = async (req, res) =>
  created(res, await service.create(body<CreateUserInput>(req), actor(req), requestMeta(req)));

export const update: RequestHandler = async (req, res) =>
  ok(res, await service.update(param(req, 'id'), body<UpdateUserInput>(req), actor(req), requestMeta(req)));

export const updateMe: RequestHandler = async (req, res) => ok(res, await service.updateMe(req.auth!.id, body<UpdateMeInput>(req)));

export const remove: RequestHandler = async (req, res) => {
  await service.remove(param(req, 'id'), actor(req), requestMeta(req));
  return noContent(res);
};

export const setRoles: RequestHandler = async (req, res) =>
  ok(res, await service.setRoles(param(req, 'id'), body<{ roles: string[] }>(req).roles, actor(req), requestMeta(req)));
