-- CreateIndex
CREATE INDEX "his_admissions_patientId_idx" ON "his_admissions"("patientId");

-- CreateIndex
CREATE INDEX "his_admissions_diagnosisCode_idx" ON "his_admissions"("diagnosisCode");

-- CreateIndex
CREATE INDEX "his_surgery_schedules_procedureCode_idx" ON "his_surgery_schedules"("procedureCode");

-- CreateIndex
CREATE INDEX "his_triages_patientId_idx" ON "his_triages"("patientId");
