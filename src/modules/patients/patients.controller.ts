import type { Request, RequestHandler } from 'express';
import { created, ok, noContent, paginated } from '../../core/http/api-response';
import { body, requestMeta } from '../../core/http/request';
import { actor } from '../../core/rbac/guards';
import * as service from './patients.service';
import type { CreatePatientInput, ListPatientsQuery, UpdatePatientInput } from './patients.schemas';

/** `validate()` ya normalizo req.query; @types/express lo sigue tipando como ParsedQs (mismo patron que users.controller.ts, B-01). */
function listQuery(req: Request): ListPatientsQuery {
  return req.query as unknown as ListPatientsQuery;
}

/**
 * `hisIdParamSchema` (his.schemas.ts) coacciona `id` a `number` en `validate()`,
 * pero Express sigue tipando `req.params` como `Record<string, string>`: mismo
 * conflicto de tipos que `listQuery`, aqui para el parametro de ruta.
 */
function idParam(req: Request): number {
  return req.params.id as unknown as number;
}

export const list: RequestHandler = async (req, res) => paginated(res, await service.list(listQuery(req)));

export const getById: RequestHandler = async (req, res) => ok(res, await service.getById(idParam(req)));

export const create: RequestHandler = async (req, res) =>
  created(res, await service.create(body<CreatePatientInput>(req), actor(req), requestMeta(req)));

export const update: RequestHandler = async (req, res) =>
  ok(res, await service.update(idParam(req), body<UpdatePatientInput>(req), actor(req), requestMeta(req)));

export const remove: RequestHandler = async (req, res) => {
  await service.remove(idParam(req), actor(req), requestMeta(req));
  return noContent(res);
};
