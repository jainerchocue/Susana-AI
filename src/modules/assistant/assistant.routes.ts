import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { noStore } from '../../core/middleware/security';
import { assistantRateLimit } from '../../core/middleware/rate-limit';
import { PERMISSIONS } from '../../core/rbac/permissions';
import * as controller from './assistant.controller';
import { askSchema } from './assistant.schemas';

/**
 * Publica: autoload la monta en `{API_PREFIX}/assistant`. La API interna del
 * agente (`/internal/agent`) vive en `assistant.internal.ts`, que NO acaba en
 * `.routes.ts` a proposito: el autoload no debe montarla aqui, solo
 * `internal-app.ts` la monta, en el segundo puerto.
 */
const router = Router();

router.use(noStore);

router.post(
  '/query',
  authenticate,
  validate({ body: askSchema }),
  requirePermissions(PERMISSIONS.assistant.use),
  assistantRateLimit,
  controller.ask,
);

export default router;
