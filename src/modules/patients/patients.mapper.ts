import type { Patient } from '@prisma/client';

/**
 * Forma publica de un paciente: SIN `birthDate` (CLAUDE.md §7, B0: "nunca sale
 * un registro de paciente" con datos que identifiquen directamente). Solo
 * sale `age`, calculada a la fecha de referencia del hospital.
 */
export interface PublicPatient {
  id: number;
  documentType: string;
  sex: string;
  insurer: string;
  regime: string;
  department: string;
  municipality: string;
  zone: string;
  age: number;
}

const CINCO_HORAS_MS = 5 * 60 * 60 * 1000;

/**
 * Edad en años completos a `referencia`, con el mismo criterio que
 * `recalcularDerivados` (his.derivados.ts, paso 5): años completos entre
 * `birthDate` y el dia calendario de Bogota de `referencia`. Colombia esta
 * fija en UTC-5 sin horario de verano (B0), asi que restar 5 horas y leer los
 * componentes UTC del resultado equivale a "AT TIME ZONE 'America/Bogota'".
 * `birthDate` ya es medianoche UTC (`fechaSimple`/`fechaSoloDiaRequerida`),
 * asi que no necesita el mismo ajuste.
 */
export function calcularEdad(birthDate: Date, referencia: Date): number {
  const refBogota = new Date(referencia.getTime() - CINCO_HORAS_MS);
  let edad = refBogota.getUTCFullYear() - birthDate.getUTCFullYear();
  const antesDelCumpleanos =
    refBogota.getUTCMonth() < birthDate.getUTCMonth() ||
    (refBogota.getUTCMonth() === birthDate.getUTCMonth() && refBogota.getUTCDate() < birthDate.getUTCDate());
  if (antesDelCumpleanos) edad -= 1;
  return edad;
}

export function toPublicPatient(patient: Patient, referencia: Date): PublicPatient {
  return {
    id: patient.id,
    documentType: patient.documentType,
    sex: patient.sex,
    insurer: patient.insurer,
    regime: patient.regime,
    department: patient.department,
    municipality: patient.municipality,
    zone: patient.zone,
    age: calcularEdad(patient.birthDate, referencia),
  };
}
