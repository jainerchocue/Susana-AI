import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { idempotencia, noStore } from '../../core/middleware/security';
import { PERMISSIONS } from '../../core/rbac/permissions';
import { hisIdParamSchema } from '../his/his.schemas';
import * as controller from './patients.controller';
import { createPatientSchema, listPatientsQuerySchema, updatePatientSchema } from './patients.schemas';

const router = Router();

// Datos de paciente: nada de cache intermedia, y toda ruta exige sesion.
router.use(noStore, authenticate);

router.get(
  '/',
  validate({ query: listPatientsQuerySchema }),
  requirePermissions(PERMISSIONS.patients.read),
  controller.list,
);

router.post(
  '/',
  requirePermissions(PERMISSIONS.data.manage),
  idempotencia,
  validate({ body: createPatientSchema }),
  controller.create,
);

router.get(
  '/:id',
  validate({ params: hisIdParamSchema }),
  requirePermissions(PERMISSIONS.patients.read),
  controller.getById,
);

router.patch(
  '/:id',
  validate({ params: hisIdParamSchema, body: updatePatientSchema }),
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
