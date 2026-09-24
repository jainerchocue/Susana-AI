import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { TestProject } from 'vitest/node';
import { E2E_DATABASE, E2E_PORT, urlBaseDatosE2E } from './entorno';
import { iniciarServidor } from './servidor';

/**
 * Global setup de la suite E2E (T12, E1). Se ejecuta UNA vez por corrida de
 * `vitest run --config vitest.e2e.config.mts` (fileParallelism: false), antes
 * de todos los archivos `tests/e2e/**\/*.e2e.test.ts` que esa corrida incluya:
 *
 *   1. `prisma migrate deploy` sobre la BD E2E (nunca `reset`: el guardian de
 *      Prisma para agentes IA lo bloquea sin consentimiento humano).
 *   2. Seed idempotente (roles, permisos, superadmin y usuarios de prueba).
 *   3. Import de los datos HIS reales (`npm run data:import`) SOLO si
 *      `his_admissions` esta vacia: la importacion tarda ~30s y es idempotente,
 *      pero no hace falta repetirla en cada relanzamiento de la suite.
 *   4. Limpieza de lo que dejaron corridas anteriores (nunca la auditoria,
 *      que es append-only).
 *   5. Arranque del proceso real (`iniciarServidor`) y publicacion de su URL
 *      con `provide()` para que los archivos de test la lean con `inject()`.
 */

declare module 'vitest' {
  interface ProvidedContext {
    e2eUrl: string;
    e2eInternalUrl: string;
  }
}

const RAIZ = path.resolve(__dirname, '..', '..');

/** Lanza un comando y espera a que termine; revienta el setup si falla. */
function ejecutar(cmd: string, args: string[], envExtra: Record<string, string>): void {
  const resultado = spawnSync(cmd, args, {
    cwd: RAIZ,
    env: { ...process.env, ...envExtra },
    stdio: 'inherit',
  });
  if (resultado.error) throw resultado.error;
  if (resultado.status !== 0) {
    throw new Error(`Fallo "${cmd} ${args.join(' ')}" (codigo de salida ${resultado.status ?? 'desconocido'}).`);
  }
}

/**
 * Deja la BD E2E como la encontraria una corrida nueva: fuera los usuarios
 * `@e2e.test` de corridas pasadas (sesiones/cuentas/roles de usuario caen en
 * cascada, ver schema.prisma), los roles `e2e-*` que crearon, todo el stock de
 * medicamentos y todas las alertas. La auditoria es append-only: no se toca.
 */
async function limpiarCorridasAnteriores(prisma: PrismaClient): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { endsWith: '@e2e.test' } } });
  await prisma.role.deleteMany({ where: { isSystem: false, name: { startsWith: 'e2e-' } } });
  await prisma.medicationStock.deleteMany();
  await prisma.alert.deleteMany();
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const inicio = Date.now();
  const urlBd = urlBaseDatosE2E();

  ejecutar('npx', ['prisma', 'migrate', 'deploy'], { DATABASE_URL: urlBd });
  ejecutar('npx', ['tsx', 'prisma/seed.ts'], {
    DATABASE_URL: urlBd,
    PASSWORD_BREACH_CHECK: 'false',
    MAIL_ENABLED: 'false',
  });

  const prisma = new PrismaClient({ datasources: { db: { url: urlBd } } });
  let importo = false;
  try {
    const admisiones = await prisma.admission.count();
    if (admisiones === 0) {
      ejecutar('npm', ['run', 'data:import'], { DATABASE_URL: urlBd });
      importo = true;
    }

    await limpiarCorridasAnteriores(prisma);
  } finally {
    await prisma.$disconnect();
  }

  const servidor = await iniciarServidor({ puerto: E2E_PORT });

  const ms = Date.now() - inicio;
  process.stdout.write(
    `\n[e2e] global-setup listo en ${ms}ms (bd=${E2E_DATABASE}, importo=${importo ? 'si' : 'no'}, url=${servidor.url})\n`,
  );

  project.provide('e2eUrl', servidor.url);
  project.provide('e2eInternalUrl', servidor.internalUrl);

  return async () => {
    await servidor.detener();
  };
}
