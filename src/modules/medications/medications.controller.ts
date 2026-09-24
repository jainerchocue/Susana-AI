import type { Request, RequestHandler } from 'express';
import { ok, paginated } from '../../core/http/api-response';
import { body, param, requestMeta } from '../../core/http/request';
import * as service from './medications.service';
import type { ConsumptionQuery, ListMedicationsQuery, UpdateStockInput } from './medications.schemas';

function listQuery(req: Request): ListMedicationsQuery {
  return req.query as unknown as ListMedicationsQuery;
}

function consumptionQuery(req: Request): ConsumptionQuery {
  return req.query as unknown as ConsumptionQuery;
}

export const list: RequestHandler = async (req, res) => paginated(res, await service.list(listQuery(req)));

export const critical: RequestHandler = async (_req, res) => ok(res, await service.critical());

export const consumption: RequestHandler = async (req, res) =>
  ok(res, await service.consumption(consumptionQuery(req)));

export const updateStock: RequestHandler = async (req, res) =>
  ok(
    res,
    await service.updateStock(param(req, 'code'), body<UpdateStockInput>(req).quantity, req.auth!.id, requestMeta(req)),
  );
