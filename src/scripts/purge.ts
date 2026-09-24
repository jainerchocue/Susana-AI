import '../bootstrap';
import { purgar } from '../core/jobs/purge';
import { disconnectDatabase } from '../core/db/prisma';
import { logger } from '../core/logger';

/** Punto de entrada para un cron externo: `npm run db:purge`. */
void purgar()
  .then((r) => {
    logger.info(r, 'Purga manual completada');
  })
  .catch((err: unknown) => {
    logger.error({ err }, 'Fallo la purga');
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectDatabase();
  });
