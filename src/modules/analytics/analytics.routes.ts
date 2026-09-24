import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { requirePermissions } from '../../core/middleware/authorize';
import { validate } from '../../core/middleware/validate';
import { noStore } from '../../core/middleware/security';
import { PERMISSIONS } from '../../core/rbac/permissions';
import * as controller from './analytics.controller';
import { analyticsQuerySchema } from './analytics.schemas';

/**
 * OJO: ningun `GET '/:algo'` en la raiz de este router. T9 monta
 * `/analytics/surgeries` en otro router (`export const basePath =
 * '/analytics/surgeries'` en surgeries.routes.ts); una ruta con parametro
 * aqui (p.ej. `GET '/:id'`) interceptaria esa peticion antes de que llegue al
 * router de cirugias, porque Express prueba las rutas de ESTE router primero.
 */
const router = Router();

router.use(noStore, authenticate);

router.get(
  '/services',
  validate({ query: analyticsQuerySchema }),
  requirePermissions([PERMISSIONS.analytics.read, PERMISSIONS.services.read]),
  controller.services,
);

router.get(
  '/triage',
  validate({ query: analyticsQuerySchema }),
  requirePermissions([PERMISSIONS.analytics.read, PERMISSIONS.services.read]),
  controller.triage,
);

router.get(
  '/services/export',
  validate({ query: analyticsQuerySchema }),
  requirePermissions([PERMISSIONS.analytics.export, PERMISSIONS.analytics.read, PERMISSIONS.services.read]),
  controller.exportServices,
);

router.get(
  '/triage/export',
  validate({ query: analyticsQuerySchema }),
  requirePermissions([PERMISSIONS.analytics.export, PERMISSIONS.analytics.read, PERMISSIONS.services.read]),
  controller.exportTriage,
);

export default router;
