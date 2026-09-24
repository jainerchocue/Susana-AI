import type { Request, RequestHandler } from 'express';
import { created, noContent, ok, paginated } from '../../core/http/api-response';
import { body, param, requestMeta } from '../../core/http/request';
import { AppError } from '../../core/http/errors';
import * as service from './medications.service';
import type {
  ConsumptionQuery,
  CreateDispenseInput,
  CreateMedicationInput,
  ListDispensesQuery,
  ListMedicationsQuery,
  ListStockQuery,
  UpdateDispenseInput,
  UpdateMedicationInput,
  UpdateStockInput,
} from './medications.schemas';

function listQuery(req: Request): ListMedicationsQuery {
  return req.query as unknown as ListMedicationsQuery;
}

function consumptionQuery(req: Request): ConsumptionQuery {
  return req.query as unknown as ConsumptionQuery;
}

function stockQuery(req: Request): ListStockQuery {
  return req.query as unknown as ListStockQuery;
}

function dispensesQuery(req: Request): ListDispensesQuery {
  return req.query as unknown as ListDispensesQuery;
}

/**
 * Lee un parametro de ruta ENTERO (`hisIdParamSchema`, ids naturales del
 * HIS): `validate()` ya lo convirtio a `number` (CLAUDE.md §4: "lo que Zod
 * devuelve reemplaza al original"), asi que `param()` (pensado para UUID/
 * `code`, que siguen siendo `string` tras validar) no sirve aqui.
 */
function idNumerico(req: Request, nombre = 'id'): number {
  const valor: unknown = req.params[nombre];
  if (typeof valor !== 'number') throw AppError.badRequest(`Parametro de ruta "${nombre}" invalido.`);
  return valor;
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

export const listStock: RequestHandler = async (req, res) => paginated(res, await service.listStock(stockQuery(req)));

export const removeStock: RequestHandler = async (req, res) => {
  await service.removeStock(param(req, 'code'), req.auth!.id, requestMeta(req));
  return noContent(res);
};

export const getByCode: RequestHandler = async (req, res) => ok(res, await service.getByCode(param(req, 'code')));

export const createMedication: RequestHandler = async (req, res) =>
  created(res, await service.createMedication(body<CreateMedicationInput>(req), req.auth!.id, requestMeta(req)));

export const updateMedication: RequestHandler = async (req, res) =>
  ok(
    res,
    await service.updateMedication(param(req, 'code'), body<UpdateMedicationInput>(req), req.auth!.id, requestMeta(req)),
  );

export const removeMedication: RequestHandler = async (req, res) => {
  await service.removeMedication(param(req, 'code'), req.auth!.id, requestMeta(req));
  return noContent(res);
};

export const listDispenses: RequestHandler = async (req, res) => {
  // `PaginateInput.nextCursor` es `string | null` (token opaco en el contrato
  // JSON, CLAUDE.md §3): el cursor entero de HIS se serializa aqui, en el
  // borde HTTP, y no en el servicio (que lo necesita como `number` para el
  // `cursor: { id }` de Prisma en la pagina siguiente).
  const resultado = await service.listDispenses(dispensesQuery(req));
  return paginated(res, {
    ...resultado,
    nextCursor: resultado.nextCursor === null ? null : String(resultado.nextCursor),
  });
};

export const getDispense: RequestHandler = async (req, res) => ok(res, await service.getDispense(idNumerico(req)));

export const createDispense: RequestHandler = async (req, res) =>
  created(res, await service.createDispense(body<CreateDispenseInput>(req), req.auth!.id, requestMeta(req)));

export const updateDispense: RequestHandler = async (req, res) =>
  ok(res, await service.updateDispense(idNumerico(req), body<UpdateDispenseInput>(req), req.auth!.id, requestMeta(req)));

export const removeDispense: RequestHandler = async (req, res) => {
  await service.removeDispense(idNumerico(req), req.auth!.id, requestMeta(req));
  return noContent(res);
};
