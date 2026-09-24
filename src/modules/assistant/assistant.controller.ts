import type { RequestHandler } from 'express';
import { ok } from '../../core/http/api-response';
import { body, requestMeta } from '../../core/http/request';
import { actor } from '../../core/rbac/guards';
import { tienePermiso } from '../../core/rbac/alcance';
import { PERMISSIONS } from '../../core/rbac/permissions';
import * as service from './assistant.service';
import type { AskInput, InternalQueryInput } from './assistant.schemas';

/** Publica, tras `authenticate` + `requirePermissions(assistant.use)`. */
export const ask: RequestHandler = async (req, res) => {
  const avanzado = tienePermiso(req.auth!.permissions, PERMISSIONS.assistant.advanced);
  const respuesta = await service.preguntar(body<AskInput>(req), actor(req), avanzado, requestMeta(req));
  ok(res, respuesta);
};

/** Interna: la llama Python, no React. Sin `req.auth` (no hay sesion en ese puerto). */
export const internalQuery: RequestHandler = async (req, res) => {
  const resultado = await service.consultaInterna(body<InternalQueryInput>(req));
  ok(res, resultado);
};
