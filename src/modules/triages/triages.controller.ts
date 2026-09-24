import type { Request, RequestHandler } from 'express';
import { created, ok, noContent, paginated } from '../../core/http/api-response';
import { body, requestMeta } from '../../core/http/request';
import { actor } from '../../core/rbac/guards';
import * as service from './triages.service';
import type { CreateTriageInput, ListTriagesQuery, UpdateTriageInput } from './triages.schemas';

function listQuery(req: Request): ListTriagesQuery {
  return req.query as unknown as ListTriagesQuery;
}

function idParam(req: Request): number {
  return req.params.id as unknown as number;
}

export const list: RequestHandler = async (req, res) => paginated(res, await service.list(listQuery(req)));

export const getById: RequestHandler = async (req, res) => ok(res, await service.getById(idParam(req)));

export const create: RequestHandler = async (req, res) =>
  created(res, await service.create(body<CreateTriageInput>(req), actor(req), requestMeta(req)));

export const update: RequestHandler = async (req, res) =>
  ok(res, await service.update(idParam(req), body<UpdateTriageInput>(req), actor(req), requestMeta(req)));

export const remove: RequestHandler = async (req, res) => {
  await service.remove(idParam(req), actor(req), requestMeta(req));
  return noContent(res);
};
