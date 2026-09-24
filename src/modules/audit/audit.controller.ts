import type { RequestHandler } from 'express';
import { ok, paginated } from '../../core/http/api-response';
import { param } from '../../core/http/request';
import * as service from './audit.service';
import type { ListAuditQuery } from './audit.schemas';

/** El controlador lee `req`, delega en el servicio y responde (CLAUDE.md §1/§6): sin `if` de negocio. */

export const list: RequestHandler = async (req, res) =>
  paginated(res, await service.list(req.query as unknown as ListAuditQuery));

export const getById: RequestHandler = async (req, res) => ok(res, await service.getById(param(req, 'id')));
