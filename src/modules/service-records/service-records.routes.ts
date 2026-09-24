import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { noStore } from '../../core/middleware/security';
import { PERMISSIONS } from '../../core/rbac/permissions';
import { hisIdParamSchema } from '../his/his.schemas';
import * as controller from './service-records.controller';
import {
  createServiceRecordSchema,
  listServiceRecordsQuerySchema,
  updateServiceRecordSchema,
} from './service-records.schemas';

const router = Router();

router.use(noStore, authenticate);

router.get(
  '/',
  validate({ query: listServiceRecordsQuerySchema }),
  requirePermissions(PERMISSIONS.services.read),
  controller.list,
);

router.post(
  '/',
  validate({ body: createServiceRecordSchema }),
  requirePermissions(PERMISSIONS.data.manage),
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
  validate({ params: hisIdParamSchema, body: updateServiceRecordSchema }),
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
