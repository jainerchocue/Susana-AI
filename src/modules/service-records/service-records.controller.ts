import type { Request, RequestHandler } from 'express';
import { created, noContent, ok, paginated } from '../../core/http/api-response';
import { body, param, requestMeta } from '../../core/http/request';
import * as service from './service-records.service';
import type {
  CreateServiceRecordInput,
  ListServiceRecordsQuery,
  UpdateServiceRecordInput,
} from './service-records.schemas';

function listQuery(req: Request): ListServiceRecordsQuery {
  return req.query as unknown as ListServiceRecordsQuery;
}

/** El `:id` ya paso por `hisIdParamSchema` (z.coerce.number()): siempre es un entero valido aqui. */
function idParam(req: Request): number {
  return Number(param(req, 'id'));
}

export const list: RequestHandler = async (req, res) => paginated(res, await service.list(listQuery(req)));

export const getById: RequestHandler = async (req, res) => ok(res, await service.getById(idParam(req)));

export const create: RequestHandler = async (req, res) =>
  created(res, await service.create(body<CreateServiceRecordInput>(req), req.auth!.id, requestMeta(req)));

export const update: RequestHandler = async (req, res) =>
  ok(
    res,
    await service.update(idParam(req), body<UpdateServiceRecordInput>(req), req.auth!.id, requestMeta(req)),
  );

export const remove: RequestHandler = async (req, res) => {
  await service.remove(idParam(req), req.auth!.id, requestMeta(req));
  return noContent(res);
};
