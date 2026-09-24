import { PrismaClient } from '@prisma/client';
import { env } from '../src/config/env';
import { auth } from '../src/core/auth/auth';
import { PERMISSION_LIST, SYSTEM_ROLES, WILDCARD_PERMISSION } from '../src/core/rbac/permissions';
import { ALERT_TYPES, UMBRALES_ALERTA_POR_DEFECTO } from '../src/modules/alerts/alerts.constants';

/**
 * Seed idempotente: se puede correr las veces que haga falta.
 * Sincroniza el catalogo de permisos y los roles de sistema con el codigo.
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  // 1) Permisos (catalogo + comodin)
  const definiciones = [
    { action: WILDCARD_PERMISSION, group: 'system', description: 'Acceso total (comodin)' },
    ...PERMISSION_LIST,
  ];

  for (const def of definiciones) {
    await prisma.permission.upsert({
      where: { action: def.action },
      create: def,
      update: { group: def.group, description: def.description },
    });
  }
  console.log(`✓ ${definiciones.length} permisos sincronizados`);

  await sembrarReglasDeAlertas();

  // 2) Roles de sistema.
  //
  // Son inmutables por API (guards.ts), asi que reescribir sus permisos aqui no
  // pisa personalizaciones de nadie: el codigo es su unica fuente de verdad
  // (auditoria M-07). Los roles creados por el cliente NO se tocan.
  for (const definicion of Object.values(SYSTEM_ROLES)) {
    const role = await prisma.role.upsert({
      where: { name: definicion.name },
      create: { name: definicion.name, description: definicion.description, isSystem: true },
      update: { description: definicion.description, isSystem: true },
    });

    const permisos = await prisma.permission.findMany({
      where: { action: { in: [...definicion.permissions] } },
      select: { id: true },
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (permisos.length > 0) {
      await prisma.rolePermission.createMany({
        data: permisos.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
    console.log(`✓ rol "${definicion.name}" con ${permisos.length} permiso(s)`);
  }

  // 3) Superadmin inicial
  const superadmin = await prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.SUPER_ADMIN.name } });
  const existente = await prisma.user.findFirst({
    where: { email: env.SEED_ADMIN_EMAIL },
    select: { id: true, emailVerified: true, accounts: { select: { providerId: true } } },
  });

  if (existente) {
    /**
     * Si alguien se registro con SEED_ADMIN_EMAIL antes del seed —el valor por
     * defecto esta publicado en .env.example— concederle superadmin seria
     * regalarle el sistema (auditoria M-06). Se exige que sea una cuenta
     * verificada y con credencial propia, y se avisa siempre.
     */
    const tieneCredencial = existente.accounts.some((a) => a.providerId === 'credential');
    if (!existente.emailVerified || !tieneCredencial) {
      throw new Error(
        `Existe una cuenta SIN VERIFICAR (o sin credencial) con ${env.SEED_ADMIN_EMAIL}.\n` +
          `El seed NO le concedera superadmin: podria haberla creado un atacante.\n` +
          `Verifica que es legitima y activala manualmente, o usa otro SEED_ADMIN_EMAIL.`,
      );
    }

    console.log(`⚠ Concediendo superadmin a la cuenta EXISTENTE ${env.SEED_ADMIN_EMAIL}`);
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: existente.id, roleId: superadmin.id } },
      create: { userId: existente.id, roleId: superadmin.id },
      update: {},
    });
    await prisma.auditLog.create({
      data: {
        action: 'role.granted.seed',
        targetType: 'user',
        targetId: existente.id,
        metadata: { role: SYSTEM_ROLES.SUPER_ADMIN.name, via: 'seed' },
      },
    });
    await sembrarUsuariosDePrueba();
    return;
  }

  /**
   * El alta pasa por Better Auth y no por Prisma: la contraseña vive en
   * `Account.password` con el formato que la libreria sabra verificar. Crearlo
   * a mano dejaria un superadmin que no puede iniciar sesion.
   */
  const alta = await auth.api.signUpEmail({
    body: {
      email: env.SEED_ADMIN_EMAIL,
      password: env.SEED_ADMIN_PASSWORD,
      name: 'Super Admin',
    },
  });

  await prisma.$transaction([
    // El superadmin del seed nace verificado: no hay bandeja de entrada que abrir.
    prisma.user.update({ where: { id: alta.user.id }, data: { emailVerified: true } }),
    // El hook de Better Auth le puso el rol por defecto: se reemplaza.
    prisma.userRole.deleteMany({ where: { userId: alta.user.id } }),
    prisma.userRole.create({ data: { userId: alta.user.id, roleId: superadmin.id } }),
    // signUpEmail abre sesion; un seed no debe dejar uno iniciada.
    prisma.session.deleteMany({ where: { userId: alta.user.id } }),
  ]);

  console.log(`✓ superadmin creado: ${env.SEED_ADMIN_EMAIL}`);
  console.log('  ⚠ Cambia la contraseña tras el primer inicio de sesion.');

  await sembrarUsuariosDePrueba();
}

/**
 * 1.5) Reglas de alertas (umbrales editables por API, TC5).
 *
 * SOLO crea las que faltan: una regla ya presente pudo haber sido editada por
 * `PATCH /alerts/rules/:type` (activada/desactivada, umbrales propios), y el
 * seed no debe pisar ese trabajo en cada redeploy.
 */
async function sembrarReglasDeAlertas(): Promise<void> {
  let creadas = 0;
  for (const type of ALERT_TYPES) {
    const existente = await prisma.alertRule.findUnique({ where: { type } });
    if (existente) continue;
    await prisma.alertRule.create({ data: { type, ...UMBRALES_ALERTA_POR_DEFECTO[type] } });
    creadas += 1;
  }
  console.log(`✓ ${creadas} regla(s) de alertas creada(s) (${ALERT_TYPES.length - creadas} ya existian)`);
}

/**
 * 4) Usuarios de prueba (DIRECTOR y FARMACIA), opcionales via SEED_TEST_USERS.
 *
 * `env.ts` ya prohibe SEED_TEST_USERS=true en produccion (fail fast al
 * arrancar), asi que aqui no hace falta repetir esa comprobacion.
 */
async function sembrarUsuariosDePrueba(): Promise<void> {
  if (!env.SEED_TEST_USERS) {
    console.log('SEED_TEST_USERS=false: no se crean usuarios de prueba.');
    return;
  }

  const usuariosDePrueba = [
    { email: env.SEED_DIRECTOR_EMAIL, nombre: 'Director de prueba', rol: SYSTEM_ROLES.DIRECTOR.name },
    { email: env.SEED_FARMACIA_EMAIL, nombre: 'Farmacia de prueba', rol: SYSTEM_ROLES.FARMACIA.name },
  ] as const;

  for (const u of usuariosDePrueba) {
    const rol = await prisma.role.findUniqueOrThrow({ where: { name: u.rol } });
    const previo = await prisma.user.findFirst({ where: { email: u.email }, select: { id: true } });

    // Si ya existe (segunda corrida del seed, o un despliegue re-sembrado) no
    // se vuelve a dar de alta por Better Auth: signUpEmail fallaria por email
    // duplicado. Solo se reasegura el rol, igual que el bloque del superadmin.
    const userId = previo
      ? previo.id
      : (
          await auth.api.signUpEmail({
            body: { email: u.email, password: env.SEED_TEST_PASSWORD, name: u.nombre },
          })
        ).user.id;

    await prisma.$transaction([
      // Cuenta de prueba: nace verificada, no hay bandeja de entrada que abrir.
      prisma.user.update({ where: { id: userId }, data: { emailVerified: true } }),
      // El hook de Better Auth (alta nueva) o una corrida anterior (reasegurar)
      // pudo dejar otro rol: este es el unico que debe quedar.
      prisma.userRole.deleteMany({ where: { userId } }),
      prisma.userRole.create({ data: { userId, roleId: rol.id } }),
      // signUpEmail abre sesion; un seed no debe dejar ninguna iniciada.
      prisma.session.deleteMany({ where: { userId } }),
    ]);

    console.log(`✓ usuario de prueba "${u.email}" con rol ${u.rol}`);
  }

  console.log('\nAccesos de prueba:');
  // Nunca la contraseña real: solo el nombre de la variable que la contiene.
  console.table(
    usuariosDePrueba.map((u) => ({ correo: u.email, rol: u.rol, contraseña: 'la de SEED_TEST_PASSWORD' })),
  );
}

main()
  .catch((error: unknown) => {
    console.error('Fallo el seed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
