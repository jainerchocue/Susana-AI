import type { Request, RequestHandler } from 'express';
import { created, ok, noContent, paginated } from '../../core/http/api-response';
import { body, requestMeta } from '../../core/http/request';
import { actor } from '../../core/rbac/guards';
import * as service from './admissions.service';
import type {
  CreateAdmissionInput,
  ListAdmissionsQuery,
  SetFirstCareInput,
  UpdateAdmissionInput,
} from './admissions.schemas';

function listQuery(req: Request): ListAdmissionsQuery {
  return req.query as unknown as ListAdmissionsQuery;
}

/** `hisIdParamSchema` ya coacciono `id` a `number` en `validate()` (mismo patron que patients.controller.ts). */
function idParam(req: Request): number {
  return req.params.id as unknown as number;
}

export const list: RequestHandler = async (req, res) => paginated(res, await service.list(listQuery(req)));

export const getById: RequestHandler = async (req, res) => ok(res, await service.getById(idParam(req)));

export const create: RequestHandler = async (req, res) =>
  created(res, await service.create(body<CreateAdmissionInput>(req), actor(req), requestMeta(req)));

export const update: RequestHandler = async (req, res) =>
  ok(res, await service.update(idParam(req), body<UpdateAdmissionInput>(req), actor(req), requestMeta(req)));

export const remove: RequestHandler = async (req, res) => {
  await service.remove(idParam(req), actor(req), requestMeta(req));
  return noContent(res);
};

export const setFirstCare: RequestHandler = async (req, res) =>
  ok(
    res,
    await service.setFirstCare(
      idParam(req),
      body<SetFirstCareInput>(req).firstCareAt,
      actor(req),
      requestMeta(req),
    ),
  );

export const clearFirstCare: RequestHandler = async (req, res) =>
  ok(res, await service.clearFirstCare(idParam(req), actor(req), requestMeta(req)));
