import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { noStore } from '../../core/middleware/security';
import { PERMISSIONS } from '../../core/rbac/permissions';
import * as controller from './roles.controller';
import {
  createRoleSchema,
  idParamSchema,
  listRolesQuerySchema,
  setRolePermissionsSchema,
  updateRoleSchema,
} from './roles.schemas';

const router = Router();

router.use(noStore, authenticate);

router.get(
  '/',
  requirePermissions(PERMISSIONS.roles.read),
  validate({ query: listRolesQuerySchema }),
  controller.list,
);

router.post(
  '/',
  requirePermissions(PERMISSIONS.roles.create),
  validate({ body: createRoleSchema }),
  controller.create,
);

router.get(
  '/:id',
  requirePermissions(PERMISSIONS.roles.read),
  validate({ params: idParamSchema }),
  controller.getById,
);

router.patch(
  '/:id',
  requirePermissions(PERMISSIONS.roles.update),
  validate({ params: idParamSchema, body: updateRoleSchema }),
  controller.update,
);

router.delete(
  '/:id',
  requirePermissions(PERMISSIONS.roles.delete),
  validate({ params: idParamSchema }),
  controller.remove,
);

router.put(
  '/:id/permissions',
  requirePermissions(PERMISSIONS.roles.assignPermissions),
  validate({ params: idParamSchema, body: setRolePermissionsSchema }),
  controller.setPermissions,
);

export default router;
