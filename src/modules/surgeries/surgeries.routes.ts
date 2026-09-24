import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { noStore } from '../../core/middleware/security';
import { PERMISSIONS } from '../../core/rbac/permissions';
import * as controller from './surgeries.controller';
import { emptyQuerySchema } from './surgeries.schemas';

/**
 * Prefijo forzado (CLAUDE.md §2): sin esto el autoload usaria `/surgeries`
 * (nombre de la carpeta). Vive bajo `/analytics` a proposito (T9): es
 * analitica de cirugias, no un recurso CRUD propio. T8 monta en paralelo
 * `/analytics` (services/triage) sin rutas con parametro en su raiz, asi que
 * ambos routers conviven: si `/analytics` no matchea `/surgeries`, Express
 * sigue probando los siguientes `app.use` hasta llegar a este.
 */
export const basePath = '/analytics/surgeries';

const router = Router();

router.use(noStore, authenticate);

router.get(
  '/',
  validate({ query: emptyQuerySchema }),
  requirePermissions([PERMISSIONS.analytics.read, PERMISSIONS.surgeries.read]),
  controller.summary,
);

router.get(
  '/export',
  validate({ query: emptyQuerySchema }),
  requirePermissions([PERMISSIONS.analytics.export, PERMISSIONS.analytics.read, PERMISSIONS.surgeries.read]),
  controller.exportCsv,
);

export default router;
