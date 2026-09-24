import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { noStore } from '../../core/middleware/security';
import { PERMISSIONS } from '../../core/rbac/permissions';
import { idParamSchema } from '../../core/http/schemas';
import { listAuditQuerySchema } from './audit.schemas';
import * as auditController from './audit.controller';

const router = Router();

// El rastro nombra actores y objetivos: nada de cache intermedia.
router.use(noStore, authenticate);

router.get(
  '/',
  // Orden de CLAUDE.md §5: validate ANTES que requirePermissions (estaba
  // invertido; se corrige de paso al tocar este archivo para TC5).
  validate({ query: listAuditQuerySchema }),
  requirePermissions(PERMISSIONS.audit.read),
  auditController.list,
);

router.get(
  '/:id',
  validate({ params: idParamSchema }),
  requirePermissions(PERMISSIONS.audit.read),
  auditController.getById,
);

export default router;
