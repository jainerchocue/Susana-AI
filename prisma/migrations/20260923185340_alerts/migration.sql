-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "message" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedBy" UUID,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alerts_status_severity_lastSeenAt_idx" ON "alerts"("status", "severity", "lastSeenAt" DESC);

-- CreateIndex
CREATE INDEX "alerts_type_scopeId_status_idx" ON "alerts"("type", "scopeId", "status");

-- CreateIndex
CREATE INDEX "alerts_scope_status_idx" ON "alerts"("scope", "status");

-- ═══════════════════════════════════════════════════════════════════════════
-- T1 renombra los roles de sistema a MAYUSCULAS_CON_GUION_BAJO (SUPER_ADMIN,
-- ADMIN, DIRECTOR, JEFE_SERVICIO, FARMACIA, ANALISTA, CONSULTA) para
-- distinguirlos a simple vista de un rol creado por un cliente via API
-- (minusculas, ver roles.schemas.ts). El CHECK `roles_name_formato` de la
-- migracion inicial solo aceptaba minusculas y bloqueaba el seed. Se amplia
-- para aceptar AMBAS convenciones; sigue siendo un CHECK, asi que Prisma no
-- lo borra al diffear.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_name_formato;
ALTER TABLE roles ADD CONSTRAINT roles_name_formato
  CHECK (name ~ '^[A-Za-z][A-Za-z0-9_-]*$' AND length(name) BETWEEN 2 AND 50);
