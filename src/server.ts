// Debe ser el PRIMER import: dimensiona el threadpool antes de que
// crypto/fs/dns lo creen con el tamaño por defecto.
import './bootstrap';

import type { Server } from 'node:http';
import { createApp } from './app';
import { createInternalApp } from './internal-app';
import { env } from './config/env';
import { logger } from './core/logger';
import { connectDatabase, disconnectDatabase } from './core/db/prisma';
import { closeRedis } from './core/cache/redis';
import { closeMailer, verifyMailer } from './core/mail/mailer';
import { programarPurga } from './core/jobs/purge';
import { programarEvaluacionAlertas } from './modules/alerts/alerts.job';

async function main(): Promise<void> {
  await connectDatabase();
  await verifyMailer();

  const app = await createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, prefix: env.API_PREFIX, threadpool: process.env.UV_THREADPOOL_SIZE },
      `API escuchando en http://localhost:${env.PORT}${env.API_PREFIX}`,
    );
  });

  // Sin timeouts explicitos se heredan los de Node (300s/60s): 1.000 conexiones
  // lentas agotan los sockets (Slowloris, auditoria A-15).
  server.headersTimeout = env.HTTP_HEADERS_TIMEOUT_MS;
  server.requestTimeout = env.HTTP_REQUEST_TIMEOUT_MS;
  // Debe superar el idle timeout del balanceador: al reves, el LB reutiliza un
  // socket que Node acaba de cerrar y el cliente recibe 502 esporadicos.
  server.keepAliveTimeout = env.HTTP_KEEPALIVE_TIMEOUT_MS;
  server.maxRequestsPerSocket = 1000;

  /**
   * Segundo puerto, solo 127.0.0.1: la API interna del agente. Sin
   * INTERNAL_API_KEY no arranca -- cierra en fallo, porque un puerto interno
   * sin clave no es "menos seguro", es una puerta sin cerradura.
   */
  let internalServer: Server | undefined;
  if (env.INTERNAL_API_KEY) {
    const internalApp = createInternalApp();
    internalServer = internalApp.listen(env.INTERNAL_PORT, env.INTERNAL_HOST, () => {
      logger.info(
        { host: env.INTERNAL_HOST, port: env.INTERNAL_PORT },
        `API interna del agente escuchando en http://${env.INTERNAL_HOST}:${env.INTERNAL_PORT}`,
      );
    });
    internalServer.headersTimeout = env.HTTP_HEADERS_TIMEOUT_MS;
    internalServer.requestTimeout = env.HTTP_REQUEST_TIMEOUT_MS;
    internalServer.keepAliveTimeout = env.HTTP_KEEPALIVE_TIMEOUT_MS;
  } else {
    logger.warn('Sin INTERNAL_API_KEY: la API interna del agente no arranca.');
  }

  const purga = programarPurga();
  const evaluacionAlertas = programarEvaluacionAlertas();

  let apagando = false;
  const shutdown = (signal: string) => () => {
    if (apagando) return;
    apagando = true;
    logger.info({ signal }, 'Apagando...');

    const forzar = setTimeout(() => {
      logger.error('Apagado forzado tras 15s');
      process.exit(1);
    }, 15_000);
    forzar.unref();

    if (purga) clearInterval(purga);
    if (evaluacionAlertas) clearInterval(evaluacionAlertas);

    const cerrarServidor = (s: Server) => new Promise<void>((resolve) => { s.close(() => resolve()); });

    void Promise.all([cerrarServidor(server), internalServer ? cerrarServidor(internalServer) : Promise.resolve()])
      .then(() => {
        closeMailer();
        return Promise.allSettled([disconnectDatabase(), closeRedis()]);
      })
      .then(() => {
        clearTimeout(forzar);
        logger.info('Apagado limpio');
        process.exit(0);
      });
  };

  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));
}

// Un error aqui deja el proceso en estado desconocido: mejor morir y que el
// orquestador reinicie.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Promesa rechazada sin manejar');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Excepcion no capturada');
  process.exit(1);
});

void main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Fallo el arranque');
  process.exit(1);
});
