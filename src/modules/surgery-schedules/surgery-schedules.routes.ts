import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { noStore } from '../../core/middleware/security';
import { PERMISSIONS } from '../../core/rbac/permissions';
import { hisIdParamSchema } from '../his/his.schemas';
import * as controller from './surgery-schedules.controller';
import {
  createSurgeryScheduleSchema,
  listSurgerySchedulesQuerySchema,
  updateSurgeryScheduleSchema,
} from './surgery-schedules.schemas';

const router = Router();

router.use(noStore, authenticate);

router.get(
  '/',
  validate({ query: listSurgerySchedulesQuerySchema }),
  requirePermissions(PERMISSIONS.surgeries.read),
  controller.list,
);

router.post(
  '/',
  validate({ body: createSurgeryScheduleSchema }),
  requirePermissions(PERMISSIONS.data.manage),
  controller.create,
);

router.get(
  '/:id',
  validate({ params: hisIdParamSchema }),
  requirePermissions(PERMISSIONS.surgeries.read),
  controller.getById,
);

router.patch(
  '/:id',
  validate({ params: hisIdParamSchema, body: updateSurgeryScheduleSchema }),
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
