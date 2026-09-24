import type { Admission, Triage } from '@prisma/client';

export interface TriageResumen {
  id: number;
  level: number | null;
  code: string;
  classification: string;
  triagedAt: string;
}

export interface PublicAdmission {
  id: number;
  consecutive: number;
  patientId: number;
  admissionClass: string;
  entryRoute: string;
  riskType: string;
  admittedAt: string;
  hospitalizedAt: string | null;
  triageId: number | null;
  bedCode: string;
  bedName: string;
  unit: string;
  subunit: string;
  virtualBed: boolean;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  firstCareAt: string | null;
  lastActivityAt: string | null;
  triageLevel: number | null;
  waitMinutes: number | null;
  stayHours: number | null;
  patientSex: string | null;
  patientRegime: string | null;
  patientZone: string | null;
  patientAge: number | null;
  triage: TriageResumen | null;
}

/** Solo lo esencial del triage vinculado: nunca los signos vitales completos en este resumen. */
function toTriageResumen(triage: Triage | null | undefined): TriageResumen | null {
  if (!triage) return null;
  return {
    id: triage.id,
    level: triage.level,
    code: triage.code,
    classification: triage.classification,
    triagedAt: triage.triagedAt.toISOString(),
  };
}

export type AdmissionConTriage = Admission & { triage?: Triage | null };

export function toPublicAdmission(admission: AdmissionConTriage): PublicAdmission {
  return {
    id: admission.id,
    consecutive: admission.consecutive,
    patientId: admission.patientId,
    admissionClass: admission.admissionClass,
    entryRoute: admission.entryRoute,
    riskType: admission.riskType,
    admittedAt: admission.admittedAt.toISOString(),
    hospitalizedAt: admission.hospitalizedAt?.toISOString() ?? null,
    triageId: admission.triageId,
    bedCode: admission.bedCode,
    bedName: admission.bedName,
    unit: admission.unit,
    subunit: admission.subunit,
    virtualBed: admission.virtualBed,
    diagnosisCode: admission.diagnosisCode,
    diagnosisName: admission.diagnosisName,
    firstCareAt: admission.firstCareAt?.toISOString() ?? null,
    lastActivityAt: admission.lastActivityAt?.toISOString() ?? null,
    triageLevel: admission.triageLevel,
    waitMinutes: admission.waitMinutes,
    stayHours: admission.stayHours,
    patientSex: admission.patientSex,
    patientRegime: admission.patientRegime,
    patientZone: admission.patientZone,
    patientAge: admission.patientAge,
    triage: toTriageResumen(admission.triage),
  };
}

/** Include estandar: trae el triage vinculado para el resumen. */
export const admissionWithTriageInclude = { triage: true } as const;
