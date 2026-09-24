import { PrismaClient } from '@prisma/client';
import { isDev } from '../../config/env';
import { logger } from '../logger';

/**
 * Instancia unica. En dev se guarda en globalThis para que el hot-reload de
 * tsx no abra una conexion nueva en cada recarga.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // `query` solo en desarrollo: en test ahoga la salida, en produccion
    // duplicaria cada consulta en el agregador de logs.
    log: ['error']
    //isDev ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (isDev) globalForPrisma.prisma = prisma;

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('Base de datos conectada');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
