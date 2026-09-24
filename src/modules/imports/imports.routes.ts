import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { noStore } from '../../core/middleware/security';
import { PERMISSIONS } from '../../core/rbac/permissions';
import { idParamSchema } from '../../core/http/schemas';
import * as controller from './imports.controller';
import { fileNameQuerySchema, listImportsQuerySchema, tablaParamSchema } from './imports.schemas';

const router = Router();

// Metadatos de subida y trabajos en curso: nada de cache intermedia.
router.use(noStore, authenticate);

/**
 * Rutas fijas (`/templates/:table`) antes de la parametrizada (`/:id`): mismo
 * criterio que `medications.routes.ts`. No colisionan de todos modos (un
 * segmento vs dos), pero el orden deja claro que es una vista propia.
 */
router.get(
  '/templates/:table',
  validate({ params: tablaParamSchema }),
  requirePermissions(PERMISSIONS.data.import),
  controller.plantilla,
);

router.post(
  '/:table',
  validate({ params: tablaParamSchema, query: fileNameQuerySchema }),
  requirePermissions(PERMISSIONS.data.import),
  controller.subir,
);

router.get(
  '/',
  validate({ query: listImportsQuerySchema }),
  requirePermissions(PERMISSIONS.data.import),
  controller.listar,
);

router.get(
  '/:id',
  validate({ params: idParamSchema }),
  requirePermissions(PERMISSIONS.data.import),
  controller.obtener,
);

router.delete(
  '/:id',
  validate({ params: idParamSchema }),
  requirePermissions(PERMISSIONS.data.import),
  controller.borrar,
);

export default router;
