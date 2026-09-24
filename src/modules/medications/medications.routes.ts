import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { noStore } from '../../core/middleware/security';
import { PERMISSIONS } from '../../core/rbac/permissions';
import * as controller from './medications.controller';
import {
  codeParamSchema,
  consumptionQuerySchema,
  listMedicationsQuerySchema,
  updateStockSchema,
} from './medications.schemas';

const router = Router();

// Inventario e insumos son estado operativo del hospital ahora mismo: nada de cache intermedia.
router.use(noStore, authenticate);

router.get(
  '/',
  validate({ query: listMedicationsQuerySchema }),
  requirePermissions(PERMISSIONS.medications.read),
  controller.list,
);

// Rutas fijas antes de la parametrizada: no colisionan (`/critical` y
// `/consumption` no tienen sufijo `/stock`), pero el orden deja claro que son
// vistas propias, no un `GET /:code`.
router.get('/critical', requirePermissions(PERMISSIONS.medications.read), controller.critical);

router.get(
  '/consumption',
  validate({ query: consumptionQuerySchema }),
  requirePermissions(PERMISSIONS.medications.read),
  controller.consumption,
);

router.put(
  '/:code/stock',
  validate({ params: codeParamSchema, body: updateStockSchema }),
  requirePermissions(PERMISSIONS.medications.manage),
  controller.updateStock,
);

export default router;
