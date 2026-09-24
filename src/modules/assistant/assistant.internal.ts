import { Router } from 'express';
import { validate } from '../../core/middleware/validate';
import * as controller from './assistant.controller';
import { internalQuerySchema } from './assistant.schemas';

/**
 * Rutas de la API interna del agente. A proposito NO se llama `*.routes.ts`:
 * el autoload de `core/router/autoload.ts` monta cualquier archivo con ese
 * sufijo en el puerto PUBLICO, y esta ruta nunca debe llegar ahi. Solo
 * `src/internal-app.ts` la importa, para el segundo puerto (127.0.0.1).
 *
 * Sin `authenticate`: en este puerto no hay sesion de usuario. La identidad
 * la demuestra el ticket (`usarTicket`, en el servicio) y el acceso a la red
 * y la clave los filtran `soloRedInterna` / `requireInternalKey` en
 * `internal-app.ts`, antes de llegar aqui.
 */
const router = Router();

router.post('/query', validate({ body: internalQuerySchema }), controller.internalQuery);

export default router;
