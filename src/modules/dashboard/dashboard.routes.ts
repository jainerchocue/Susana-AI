import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { noStore } from '../../core/middleware/security';
import { PERMISSIONS } from '../../core/rbac/permissions';
import * as controller from './dashboard.controller';
import { dashboardQuerySchema } from './dashboard.schemas';

const router = Router();

// El panel refleja el estado operativo actual del hospital: nada de cache intermedia.
router.use(noStore, authenticate);

router.get(
  '/summary',
  validate({ query: dashboardQuerySchema }),
  requirePermissions(PERMISSIONS.dashboard.read),
  controller.summary,
);

router.get(
  '/occupancy',
  validate({ query: dashboardQuerySchema }),
  requirePermissions([PERMISSIONS.dashboard.read, PERMISSIONS.services.read]),
  controller.occupancy,
);

router.get(
  '/wait-times',
  validate({ query: dashboardQuerySchema }),
  requirePermissions([PERMISSIONS.dashboard.read, PERMISSIONS.services.read]),
  controller.waitTimes,
);

router.get(
  '/demand',
  validate({ query: dashboardQuerySchema }),
  requirePermissions([PERMISSIONS.dashboard.read, PERMISSIONS.services.read]),
  controller.demand,
);

export default router;
