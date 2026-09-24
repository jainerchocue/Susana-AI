import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { idempotencia, noStore } from '../../core/middleware/security';
import { PERMISSIONS } from '../../core/rbac/permissions';
import { hisIdParamSchema } from '../his/his.schemas';
import * as controller from './triages.controller';
import { createTriageSchema, listTriagesQuerySchema, updateTriageSchema } from './triages.schemas';

const router = Router();

router.use(noStore, authenticate);

router.get(
  '/',
  validate({ query: listTriagesQuerySchema }),
  requirePermissions(PERMISSIONS.services.read),
  controller.list,
);

router.post(
  '/',
  requirePermissions(PERMISSIONS.data.manage),
  idempotencia,
  validate({ body: createTriageSchema }),
  controller.create,
);

router.get(
  '/:id',
  validate({ params: hisIdParamSchema }),
  requirePermissions(PERMISSIONS.services.read),
  controller.getById,
);

router.patch(
  '/:id',
  validate({ params: hisIdParamSchema, body: updateTriageSchema }),
  requirePermissions(PERMISSIONS.data.manage),
  controller.update,
);

router.delete(
  '/:id',
  validate({ params: hisIdParamSchema }),
  requirePermissions(PERMISSIONS.data.manage),
  controller.remove,
);

export default router;
