import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { noStore } from '../../core/middleware/security';
import { PERMISSIONS } from '../../core/rbac/permissions';
import * as controller from './alerts.controller';
import { idParamSchema, listAlertsQuerySchema, updateAlertSchema } from './alerts.schemas';

const router = Router();

// Las alertas reflejan el estado operativo del hospital ahora mismo: nada de cache intermedia.
router.use(noStore, authenticate);

router.get(
  '/',
  validate({ query: listAlertsQuerySchema }),
  requirePermissions(PERMISSIONS.alerts.read),
  controller.list,
);

router.get(
  '/:id',
  validate({ params: idParamSchema }),
  requirePermissions(PERMISSIONS.alerts.read),
  controller.getById,
);

router.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateAlertSchema }),
  requirePermissions(PERMISSIONS.alerts.manage),
  controller.updateStatus,
);

// Sin body ni query que validar: dispara la misma evaluacion que el job
// periodico (ALERT_EVAL_INTERVAL_MINUTES), fuera de su calendario.
router.post('/evaluate', requirePermissions(PERMISSIONS.alerts.manage), controller.evaluate);

export default router;
