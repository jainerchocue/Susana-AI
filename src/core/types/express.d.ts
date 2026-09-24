import type { AuthenticatedUser } from '../middleware/authenticate';

declare global {
  namespace Express {
    interface Request {
      /** Lo rellena `authenticate`. Ausente en rutas publicas. */
      auth?: AuthenticatedUser;
    }
    interface Locals {
      requestId: string;
      /** X-Request-Id del cliente, solo como referencia cruzada. */
      upstreamRequestId?: string;
    }
  }
}

export {};
