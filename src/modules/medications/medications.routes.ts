import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { noStore } from '../../core/middleware/security';
import { PERMISSIONS } from '../../core/rbac/permissions';
import { hisIdParamSchema } from '../his/his.schemas';
import * as controller from './medications.controller';
import {
  codeParamSchema,
  consumptionQuerySchema,
  createDispenseSchema,
  createMedicationSchema,
  listDispensesQuerySchema,
  listMedicationsQuerySchema,
  listStockQuerySchema,
  updateDispenseSchema,
  updateMedicationSchema,
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

router.post(
  '/',
  validate({ body: createMedicationSchema }),
  requirePermissions(PERMISSIONS.medications.manage),
  controller.createMedication,
);

// Rutas FIJAS antes de las PARAMETRIZADAS (TC4): `/stock`, `/dispenses[/:id]`,
// `/critical` y `/consumption` deben montarse antes de `/:code`, o Express
// haria matching de p.ej. `GET /stock` contra `GET /:code` (con code="stock")
// por estar registrada antes -- Express prueba las rutas EN ORDEN, no por
// especificidad.
router.get(
  '/stock',
  validate({ query: listStockQuerySchema }),
  requirePermissions(PERMISSIONS.medications.read),
  controller.listStock,
);

router.get(
  '/dispenses',
  validate({ query: listDispensesQuerySchema }),
  requirePermissions(PERMISSIONS.medications.read),
  controller.listDispenses,
);

router.post(
  '/dispenses',
  validate({ body: createDispenseSchema }),
  requirePermissions(PERMISSIONS.data.manage),
  controller.createDispense,
);

router.get(
  '/dispenses/:id',
  validate({ params: hisIdParamSchema }),
  requirePermissions(PERMISSIONS.medications.read),
  controller.getDispense,
);

router.patch(
  '/dispenses/:id',
  validate({ params: hisIdParamSchema, body: updateDispenseSchema }),
  requirePermissions(PERMISSIONS.data.manage),
  controller.updateDispense,
);

router.delete(
  '/dispenses/:id',
  validate({ params: hisIdParamSchema }),
  requirePermissions(PERMISSIONS.data.manage),
  controller.removeDispense,
);

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

router.delete(
  '/:code/stock',
  validate({ params: codeParamSchema }),
  requirePermissions(PERMISSIONS.medications.manage),
  controller.removeStock,
);

// Parametrizadas AL FINAL (TC4): cualquier ruta fija que se añada despues de
// esto colisionaria con `/:code`.
router.get(
  '/:code',
  validate({ params: codeParamSchema }),
  requirePermissions(PERMISSIONS.medications.read),
  controller.getByCode,
);

router.patch(
  '/:code',
  validate({ params: codeParamSchema, body: updateMedicationSchema }),
  requirePermissions(PERMISSIONS.medications.manage),
  controller.updateMedication,
);

router.delete(
  '/:code',
  validate({ params: codeParamSchema }),
  requirePermissions(PERMISSIONS.medications.manage),
  controller.removeMedication,
);

export default router;
