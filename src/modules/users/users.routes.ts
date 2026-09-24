import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requireOwnershipOr, requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { idempotencia, noStore } from '../../core/middleware/security';
import { param } from '../../core/http/request';
import { PERMISSIONS } from '../../core/rbac/permissions';
import * as controller from './users.controller';
import {
  createUserSchema,
  idParamSchema,
  listUsersQuerySchema,
  setUserRolesSchema,
  updateMeSchema,
  updateUserSchema,
} from './users.schemas';

const router = Router();

// Todo el modulo expone datos personales: nada de cache intermedia.
router.use(noStore);
// Todo el modulo exige sesion. El permiso concreto va ruta por ruta.
router.use(authenticate);

// ─── Perfil propio: no requiere permisos administrativos ─────────────────────
router.get('/me', controller.getMe);
// updateMeSchema NO incluye `status`: un usuario no se administra a si mismo.
router.patch('/me', validate({ body: updateMeSchema }), controller.updateMe);

// ─── Administracion ──────────────────────────────────────────────────────────
router.get(
  '/',
  requirePermissions(PERMISSIONS.users.read),
  validate({ query: listUsersQuerySchema }),
  controller.list,
);

router.post(
  '/',
  requirePermissions(PERMISSIONS.users.create),
  idempotencia,
  validate({ body: createUserSchema }),
  controller.create,
);

router.get(
  '/:id',
  validate({ params: idParamSchema }),
  requireOwnershipOr(PERMISSIONS.users.read, (req) => param(req, 'id')),
  controller.getById,
);

router.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateUserSchema }),
  requirePermissions(PERMISSIONS.users.update),
  controller.update,
);

router.delete(
  '/:id',
  validate({ params: idParamSchema }),
  requirePermissions(PERMISSIONS.users.delete),
  controller.remove,
);

router.put(
  '/:id/roles',
  validate({ params: idParamSchema, body: setUserRolesSchema }),
  requirePermissions(PERMISSIONS.users.assignRoles),
  controller.setRoles,
);

export default router;
