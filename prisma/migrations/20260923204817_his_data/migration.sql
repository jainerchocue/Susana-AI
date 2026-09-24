-- CreateTable
CREATE TABLE "his_patients" (
    "id" INTEGER NOT NULL,
    "documentType" TEXT NOT NULL,
    "birthDate" DATE NOT NULL,
    "sex" TEXT NOT NULL,
    "insurer" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "municipality" TEXT NOT NULL,
    "zone" TEXT NOT NULL,

    CONSTRAINT "his_patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "his_triages" (
    "id" INTEGER NOT NULL,
    "triagedAt" TIMESTAMPTZ(3) NOT NULL,
    "systolic" INTEGER,
    "diastolic" INTEGER,
    "heartRate" INTEGER,
    "respiratoryRate" INTEGER,
    "temperature" DOUBLE PRECISION,
    "patientId" INTEGER,
    "code" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "level" INTEGER,

    CONSTRAINT "his_triages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "his_admissions" (
    "id" INTEGER NOT NULL,
    "consecutive" INTEGER NOT NULL,
    "patientId" INTEGER NOT NULL,
    "admissionClass" TEXT NOT NULL,
    "entryRoute" TEXT NOT NULL,
    "riskType" TEXT NOT NULL,
    "admittedAt" TIMESTAMPTZ(3) NOT NULL,
    "hospitalizedAt" TIMESTAMPTZ(3),
    "triageId" INTEGER,
    "bedCode" TEXT NOT NULL,
    "bedName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "subunit" TEXT NOT NULL,
    "virtualBed" BOOLEAN NOT NULL,
    "diagnosisCode" TEXT,
    "diagnosisName" TEXT,
    "firstCareAt" TIMESTAMPTZ(3),
    "lastActivityAt" TIMESTAMPTZ(3),
    "triageLevel" INTEGER,
    "waitMinutes" DOUBLE PRECISION,
    "stayHours" DOUBLE PRECISION,
    "patientSex" TEXT,
    "patientRegime" TEXT,
    "patientZone" TEXT,
    "patientAge" INTEGER,

    CONSTRAINT "his_admissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "his_procedures" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "his_procedures_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "his_medications" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "his_medications_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "his_service_records" (
    "id" INTEGER NOT NULL,
    "admissionId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "providedAt" TIMESTAMPTZ(3) NOT NULL,
    "areaCode" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,

    CONSTRAINT "his_service_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "his_medication_dispenses" (
    "id" INTEGER NOT NULL,
    "admissionId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "dispensedAt" TIMESTAMPTZ(3) NOT NULL,
    "area" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,

    CONSTRAINT "his_medication_dispenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "his_surgery_schedules" (
    "id" SERIAL NOT NULL,
    "scheduleNumber" TEXT NOT NULL,
    "patientId" INTEGER NOT NULL,
    "admissionId" INTEGER,
    "procedureCode" TEXT NOT NULL,
    "executed" TEXT NOT NULL,

    CONSTRAINT "his_surgery_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_stock" (
    "code" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "updatedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medication_stock_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "his_triages_triagedAt_idx" ON "his_triages"("triagedAt");

-- CreateIndex
CREATE INDEX "his_triages_level_idx" ON "his_triages"("level");

-- CreateIndex
CREATE UNIQUE INDEX "his_admissions_triageId_key" ON "his_admissions"("triageId");

-- CreateIndex
CREATE INDEX "his_admissions_admittedAt_idx" ON "his_admissions"("admittedAt");

-- CreateIndex
CREATE INDEX "his_admissions_unit_admittedAt_idx" ON "his_admissions"("unit", "admittedAt");

-- CreateIndex
CREATE INDEX "his_admissions_lastActivityAt_idx" ON "his_admissions"("lastActivityAt");

-- CreateIndex
CREATE INDEX "his_admissions_triageLevel_idx" ON "his_admissions"("triageLevel");

-- CreateIndex
CREATE INDEX "his_medications_kind_idx" ON "his_medications"("kind");

-- CreateIndex
CREATE INDEX "his_service_records_admissionId_idx" ON "his_service_records"("admissionId");

-- CreateIndex
CREATE INDEX "his_service_records_providedAt_idx" ON "his_service_records"("providedAt");

-- CreateIndex
CREATE INDEX "his_service_records_area_providedAt_idx" ON "his_service_records"("area", "providedAt");

-- CreateIndex
CREATE INDEX "his_service_records_code_idx" ON "his_service_records"("code");

-- CreateIndex
CREATE INDEX "his_medication_dispenses_code_dispensedAt_idx" ON "his_medication_dispenses"("code", "dispensedAt");

-- CreateIndex
CREATE INDEX "his_medication_dispenses_dispensedAt_idx" ON "his_medication_dispenses"("dispensedAt");

-- CreateIndex
CREATE INDEX "his_medication_dispenses_admissionId_idx" ON "his_medication_dispenses"("admissionId");

-- CreateIndex
CREATE INDEX "his_surgery_schedules_scheduleNumber_idx" ON "his_surgery_schedules"("scheduleNumber");

-- CreateIndex
CREATE INDEX "his_surgery_schedules_admissionId_idx" ON "his_surgery_schedules"("admissionId");

-- CreateIndex
CREATE INDEX "his_surgery_schedules_executed_idx" ON "his_surgery_schedules"("executed");

-- CreateIndex
CREATE UNIQUE INDEX "his_surgery_schedules_scheduleNumber_patientId_admissionId__key" ON "his_surgery_schedules"("scheduleNumber", "patientId", "admissionId", "procedureCode");

-- AddForeignKey
ALTER TABLE "his_triages" ADD CONSTRAINT "his_triages_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "his_patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "his_admissions" ADD CONSTRAINT "his_admissions_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "his_patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "his_admissions" ADD CONSTRAINT "his_admissions_triageId_fkey" FOREIGN KEY ("triageId") REFERENCES "his_triages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "his_service_records" ADD CONSTRAINT "his_service_records_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "his_admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "his_service_records" ADD CONSTRAINT "his_service_records_code_fkey" FOREIGN KEY ("code") REFERENCES "his_procedures"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "his_medication_dispenses" ADD CONSTRAINT "his_medication_dispenses_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "his_admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "his_medication_dispenses" ADD CONSTRAINT "his_medication_dispenses_code_fkey" FOREIGN KEY ("code") REFERENCES "his_medications"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
