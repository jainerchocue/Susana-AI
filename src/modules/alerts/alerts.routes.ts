import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { noStore } from '../../core/middleware/security';
import { PERMISSIONS } from '../../core/rbac/permissions';
import * as controller from './alerts.controller';
import {
  createManualAlertSchema,
  idParamSchema,
  listAlertsQuerySchema,
  ruleTypeParamSchema,
  updateAlertSchema,
  updateRuleSchema,
} from './alerts.schemas';

const router = Router();

// Las alertas reflejan el estado operativo del hospital ahora mismo: nada de cache intermedia.
router.use(noStore, authenticate);

// ─── Reglas del motor (BD, TC5) ─────────────────────────────────────────────
// OJO: rutas fijas ("/rules", "/rules/:type") ANTES de "/:id" (valida uuid):
// si "/:id" fuera primero, "GET /alerts/rules" (un solo segmento, igual que
// "/:id") caeria en ese patron y `validate(idParamSchema)` la rechazaria con
// 422 antes de llegar aqui. "/rules/:type" tiene dos segmentos y nunca
// colisionaria, pero se agrupan igual por claridad.

router.get('/rules', requirePermissions(PERMISSIONS.alerts.read), controller.listRules);

router.get(
  '/rules/:type',
  validate({ params: ruleTypeParamSchema }),
  requirePermissions(PERMISSIONS.alerts.read),
  controller.getRule,
);

router.patch(
  '/rules/:type',
  validate({ params: ruleTypeParamSchema, body: updateRuleSchema }),
  requirePermissions(PERMISSIONS.system.manage),
  controller.updateRule,
);

// Sin body ni query que validar: dispara la misma evaluacion que el job
// periodico (ALERT_EVAL_INTERVAL_MINUTES), fuera de su calendario.
router.post('/evaluate', requirePermissions(PERMISSIONS.alerts.manage), controller.evaluate);

router.get(
  '/',
  validate({ query: listAlertsQuerySchema }),
  requirePermissions(PERMISSIONS.alerts.read),
  controller.list,
);

// Alerta manual (TC5): un operador reporta un problema que el motor no detecta.
router.post(
  '/',
  validate({ body: createManualAlertSchema }),
  requirePermissions(PERMISSIONS.alerts.manage),
  controller.createManual,
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

// Solo manuales o RESOLVED (409 en cualquier otro caso, alerts.service.ts#remove).
router.delete(
  '/:id',
  validate({ params: idParamSchema }),
  requirePermissions(PERMISSIONS.alerts.manage),
  controller.remove,
);

export default router;
