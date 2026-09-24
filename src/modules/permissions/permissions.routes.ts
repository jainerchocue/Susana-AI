import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { noStore } from '../../core/middleware/security';
import { ok } from '../../core/http/api-response';
import { PERMISSIONS } from '../../core/rbac/permissions';
import * as service from './permissions.service';

const router = Router();

router.use(noStore, authenticate);

router.get('/', requirePermissions(PERMISSIONS.permissions.read), async (_req, res) =>
  ok(res, await service.listarAgrupados()),
);

export default router;
