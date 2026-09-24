import type { RequestHandler } from 'express';
import { ok } from '../../core/http/api-response';
import { enviarCsv } from '../../core/http/csv';
import { requestMeta } from '../../core/http/request';
import * as service from './surgeries.service';

const COLUMNAS_EXPORT = [
  'scheduleNumber',
  'patientId',
  'admissionId',
  'procedureCode',
  'procedureName',
  'unit',
  'executed',
];

export const summary: RequestHandler = async (_req, res) => ok(res, await service.resumen());

export const exportCsv: RequestHandler = async (req, res) => {
  // La auditoria de la exportacion vive en el servicio (CLAUDE.md §6: el
  // controlador lee, delega y responde, sin logica propia).
  const filas = await service.exportar(req.auth!.id, requestMeta(req));
  // `enviarCsv` pide `Record<string, unknown>[]`: se copian los campos a un
  // objeto nuevo en vez de un `as` que calle al compilador (CLAUDE.md §11).
  const filasCsv: Record<string, unknown>[] = filas.map((f) => ({ ...f }));
  enviarCsv(res, 'cirugias-programadas', COLUMNAS_EXPORT, filasCsv);
};
