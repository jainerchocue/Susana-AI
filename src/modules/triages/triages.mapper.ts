import type { Triage } from '@prisma/client';

export interface PublicTriage {
  id: number;
  triagedAt: string;
  systolic: number | null;
  diastolic: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  temperature: number | null;
  patientId: number | null;
  code: string;
  classification: string;
  level: number | null;
}

export function toPublicTriage(triage: Triage): PublicTriage {
  return {
    id: triage.id,
    triagedAt: triage.triagedAt.toISOString(),
    systolic: triage.systolic,
    diastolic: triage.diastolic,
    heartRate: triage.heartRate,
    respiratoryRate: triage.respiratoryRate,
    temperature: triage.temperature,
    patientId: triage.patientId,
    code: triage.code,
    classification: triage.classification,
    level: triage.level,
  };
}
