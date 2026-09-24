import type { Request, RequestHandler } from 'express';
import { created, noContent, ok, paginated } from '../../core/http/api-response';
import { body, param, requestMeta } from '../../core/http/request';
import * as service from './procedures.service';
import type { CreateProcedureInput, ListProceduresQuery, UpdateProcedureInput } from './procedures.schemas';

function listQuery(req: Request): ListProceduresQuery {
  return req.query as unknown as ListProceduresQuery;
}

export const list: RequestHandler = async (req, res) => paginated(res, await service.list(listQuery(req)));

export const getByCode: RequestHandler = async (req, res) => ok(res, await service.getByCode(param(req, 'code')));

export const create: RequestHandler = async (req, res) =>
  created(res, await service.create(body<CreateProcedureInput>(req), req.auth!.id, requestMeta(req)));

export const update: RequestHandler = async (req, res) =>
  ok(
    res,
    await service.update(param(req, 'code'), body<UpdateProcedureInput>(req), req.auth!.id, requestMeta(req)),
  );

export const remove: RequestHandler = async (req, res) => {
  await service.remove(param(req, 'code'), req.auth!.id, requestMeta(req));
  return noContent(res);
};
