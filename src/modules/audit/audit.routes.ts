import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { noStore } from '../../core/middleware/security';
import { paginated } from '../../core/http/api-response';
import { PERMISSIONS } from '../../core/rbac/permissions';
import { listAuditQuerySchema, type ListAuditQuery } from './audit.schemas';
import * as service from './audit.service';

const router = Router();

// El rastro nombra actores y objetivos: nada de cache intermedia.
router.use(noStore, authenticate);

router.get(
  '/',
  requirePermissions(PERMISSIONS.audit.read),
  validate({ query: listAuditQuerySchema }),
  async (req, res) => paginated(res, await service.list(req.query as unknown as ListAuditQuery)),
);

export default router;
