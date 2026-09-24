import { Prisma, type PrismaClient } from '@prisma/client';
import { HIS_ZONA_HORARIA } from './his.periodo';

/**
 * Derivados de los datos HIS: una pasada de SQL estatico (nunca fila a fila
 * desde JS), extraida de `src/scripts/import-data.ts` (`calcularDerivados`)
 * para que el importador Y los CRUD de escritura (TC2-TC4) compartan
 * EXACTAMENTE la misma logica. Sin este contrato compartido, un PATCH sobre
 * un ingreso (p. ej. cambiar `admittedAt`) dejaria `waitMinutes`/`stayHours`
 * desactualizados hasta el proximo reimport completo.
 *
 * `filtro.admissionIds` acota las UPDATE a los ingresos indicados (y a las
 * `his_surgery_schedules` que apuntan a ellos): un CRUD que toca un puñado de
 * filas no debe recalcular las ~18.000 restantes. Sin filtro, el
 * comportamiento es el mismo que el importador (recalcula todo).
 */

/** `a.id = ANY(...)` cuando hay filtro; `TRUE` (sin filtrar) si no. */
function condicionIngresos(admissionIds?: number[]): Prisma.Sql {
  if (!admissionIds || admissionIds.length === 0) return Prisma.sql`TRUE`;
  return Prisma.sql`a.id = ANY(${admissionIds}::int[])`;
}

/** Misma idea que `condicionIngresos`, pero para `his_surgery_schedules AS s`. */
function condicionCirugias(admissionIds?: number[]): Prisma.Sql {
  if (!admissionIds || admissionIds.length === 0) return Prisma.sql`TRUE`;
  return Prisma.sql`s."admissionId" = ANY(${admissionIds}::int[])`;
}

export async function recalcularDerivados(
  db: Prisma.TransactionClient | PrismaClient,
  filtro?: { admissionIds?: number[] },
): Promise<void> {
  const condIngresos = condicionIngresos(filtro?.admissionIds);
  const condCirugias = condicionCirugias(filtro?.admissionIds);

  // 1) lastActivityAt: max(providedAt) U max(dispensedAt) por ingreso. Sin
  // fecha de egreso en el HIS, es la mejor aproximacion al fin de la estancia.
  await db.$executeRaw`
    UPDATE his_admissions AS a
    SET "lastActivityAt" = sub.maximo
    FROM (
      SELECT "admissionId" AS id, MAX(ts) AS maximo FROM (
        SELECT "admissionId", "providedAt" AS ts FROM his_service_records
        UNION ALL
        SELECT "admissionId", "dispensedAt" AS ts FROM his_medication_dispenses
      ) AS actividad
      GROUP BY "admissionId"
    ) AS sub
    WHERE a.id = sub.id AND ${condIngresos}
  `;

  // 2) triageLevel: copia de Triage.level (evita JOIN en cada consulta de analitica).
  await db.$executeRaw`
    UPDATE his_admissions AS a
    SET "triageLevel" = t.level
    FROM his_triages AS t
    WHERE a."triageId" = t.id AND ${condIngresos}
  `;

  // 3) waitMinutes: minutos entre el triage y la primera atencion.
  await db.$executeRaw`
    UPDATE his_admissions AS a
    SET "waitMinutes" = EXTRACT(EPOCH FROM (a."firstCareAt" - t."triagedAt")) / 60.0
    FROM his_triages AS t
    WHERE a."triageId" = t.id AND a."firstCareAt" IS NOT NULL AND ${condIngresos}
  `;

  // 4) stayHours: horas entre el ingreso y la ultima actividad registrada.
  await db.$executeRaw`
    UPDATE his_admissions AS a
    SET "stayHours" = EXTRACT(EPOCH FROM (a."lastActivityAt" - a."admittedAt")) / 3600.0
    WHERE a."lastActivityAt" IS NOT NULL AND ${condIngresos}
  `;

  // 5) snapshot de paciente en el momento del ingreso. La edad se calcula en
  // la fecha de Colombia del ingreso, no en la del huso horario de la sesion
  // de Postgres (que normalmente es UTC): un ingreso de madrugada podria caer
  // en el dia equivocado y desplazar la edad en un caso extremo.
  await db.$executeRaw`
    UPDATE his_admissions AS a
    SET "patientSex" = p.sex, "patientRegime" = p.regime, "patientZone" = p.zone,
        "patientAge" = EXTRACT(YEAR FROM age((a."admittedAt" AT TIME ZONE ${HIS_ZONA_HORARIA})::date, p."birthDate"))::int
    FROM his_patients AS p
    WHERE a."patientId" = p.id AND ${condIngresos}
  `;

  // 6) executed de SurgerySchedule: 'desconocido' sin ingreso verificable en
  // el extracto; si no, 'si'/'no' segun si ServiceRecord tiene ese codigo
  // para ese mismo ingreso. Filtrado por `s."admissionId"`: sin ingreso
  // tocado, no hay nada que recalcular aqui (el resto de columnas de la fila
  // no cambian).
  await db.$executeRaw`
    UPDATE his_surgery_schedules AS s
    SET executed = CASE
      WHEN s."admissionId" IS NULL OR NOT EXISTS (SELECT 1 FROM his_admissions a WHERE a.id = s."admissionId")
        THEN 'desconocido'
      WHEN EXISTS (
        SELECT 1 FROM his_service_records sr
        WHERE sr."admissionId" = s."admissionId" AND sr.code = s."procedureCode"
      ) THEN 'si'
      ELSE 'no'
    END
    WHERE ${condCirugias}
  `;
}
