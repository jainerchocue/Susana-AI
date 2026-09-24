import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { noStore } from '../../core/middleware/security';
import { PERMISSIONS } from '../../core/rbac/permissions';
import * as controller from './procedures.controller';
import {
  createProcedureSchema,
  listProceduresQuerySchema,
  procedureCodeParamSchema,
  updateProcedureSchema,
} from './procedures.schemas';

const router = Router();

router.use(noStore, authenticate);

router.get(
  '/',
  validate({ query: listProceduresQuerySchema }),
  requirePermissions(PERMISSIONS.services.read),
  controller.list,
);

router.post(
  '/',
  validate({ body: createProcedureSchema }),
  requirePermissions(PERMISSIONS.data.manage),
  controller.create,
);

router.get(
  '/:code',
  validate({ params: procedureCodeParamSchema }),
  requirePermissions(PERMISSIONS.services.read),
  controller.getByCode,
);

router.patch(
  '/:code',
  validate({ params: procedureCodeParamSchema, body: updateProcedureSchema }),
  requirePermissions(PERMISSIONS.data.manage),
  controller.update,
);

router.delete(
  '/:code',
  validate({ params: procedureCodeParamSchema }),
  requirePermissions(PERMISSIONS.data.manage),
  controller.remove,
);

export default router;
