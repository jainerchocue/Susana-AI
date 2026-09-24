import type { Request, RequestHandler } from 'express';
import { created, noContent, ok, paginated } from '../../core/http/api-response';
import { body, requestMeta } from '../../core/http/request';
import { AppError } from '../../core/http/errors';
import * as service from './surgery-schedules.service';
import type {
  CreateSurgeryScheduleInput,
  ListSurgerySchedulesQuery,
  UpdateSurgeryScheduleInput,
} from './surgery-schedules.schemas';

function listQuery(req: Request): ListSurgerySchedulesQuery {
  return req.query as unknown as ListSurgerySchedulesQuery;
}

/**
 * Lee el `:id` de ruta ENTERO (`hisIdParamSchema`): `validate()` ya lo
 * convirtio a `number`, asi que `param()` (pensado para UUID/`code`) no sirve
 * aqui. Mismo patron que `medications.controller.ts#idNumerico`: comprobacion
 * en tiempo de ejecucion, nunca un `as` que calle al compilador (CLAUDE.md §11).
 */
function idParam(req: Request): number {
  const valor: unknown = req.params.id;
  if (typeof valor !== 'number') throw AppError.badRequest('Parametro de ruta "id" invalido.');
  return valor;
}

export const list: RequestHandler = async (req, res) => paginated(res, await service.list(listQuery(req)));

export const getById: RequestHandler = async (req, res) => ok(res, await service.getById(idParam(req)));

export const create: RequestHandler = async (req, res) =>
  created(res, await service.create(body<CreateSurgeryScheduleInput>(req), req.auth!.id, requestMeta(req)));

export const update: RequestHandler = async (req, res) =>
  ok(
    res,
    await service.update(idParam(req), body<UpdateSurgeryScheduleInput>(req), req.auth!.id, requestMeta(req)),
  );

export const remove: RequestHandler = async (req, res) => {
  await service.remove(idParam(req), req.auth!.id, requestMeta(req));
  return noContent(res);
};
