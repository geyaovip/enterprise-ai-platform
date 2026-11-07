-- CreateTable
CREATE TABLE "GeoGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "GeoGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoSettings" (
    "tenantId" TEXT NOT NULL,
    "dailyBudgetMicros" INTEGER NOT NULL DEFAULT 20000000,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "GeoSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "GeoProject" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "aliases" TEXT[],
    "competitors" TEXT[],
    "website" TEXT,
    "country" TEXT NOT NULL DEFAULT 'CN',
    "language" TEXT NOT NULL DEFAULT 'zh-CN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoQuestion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '品牌认知',
    "nativeWebSearch" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoModel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoModelVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "apiMode" TEXT NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "nativeWebSearch" BOOLEAN NOT NULL DEFAULT false,
    "inputPriceMicrosPerMillion" INTEGER NOT NULL,
    "outputPriceMicrosPerMillion" INTEGER NOT NULL,
    "searchPriceMicros" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoAnalysis" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "snapshot" JSONB NOT NULL,
    "comparabilityHash" TEXT NOT NULL,
    "estimatedCostMicros" INTEGER NOT NULL,
    "actualCostMicros" INTEGER,
    "report" JSONB,
    "baselineId" TEXT,
    "optimizationId" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "errorCode" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "GeoAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "retryAt" TIMESTAMP(3),
    "question" JSONB NOT NULL,
    "model" JSONB NOT NULL,
    "text" TEXT,
    "citations" JSONB,
    "parsed" JSONB,
    "validSample" BOOLEAN NOT NULL DEFAULT false,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "actualCostMicros" INTEGER,
    "estimatedCostMicros" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "externalId" TEXT,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "GeoRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "frequency" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL,
    "questionIds" TEXT[],
    "modelIds" TEXT[],
    "maxCostMicros" INTEGER NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoScheduleExecution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "snapshot" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "retryAt" TIMESTAMP(3),
    "analysisId" TEXT,
    "errorCode" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoScheduleExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoOptimization" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "baselineId" TEXT NOT NULL,
    "assigneeMembershipId" TEXT,
    "evidenceUrl" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoOptimization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeoGrant_tenantId_membershipId_key" ON "GeoGrant"("tenantId", "membershipId");

-- CreateIndex
CREATE INDEX "GeoProject_tenantId_active_createdAt_idx" ON "GeoProject"("tenantId", "active", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GeoProject_id_tenantId_key" ON "GeoProject"("id", "tenantId");

-- CreateIndex
CREATE INDEX "GeoQuestion_tenantId_projectId_enabled_idx" ON "GeoQuestion"("tenantId", "projectId", "enabled");

-- CreateIndex
CREATE INDEX "GeoModel_tenantId_enabled_idx" ON "GeoModel"("tenantId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "GeoModel_id_tenantId_key" ON "GeoModel"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "GeoModelVersion_modelId_revision_key" ON "GeoModelVersion"("modelId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "GeoModelVersion_id_tenantId_key" ON "GeoModelVersion"("id", "tenantId");

-- CreateIndex
CREATE INDEX "GeoAnalysis_status_leaseUntil_createdAt_idx" ON "GeoAnalysis"("status", "leaseUntil", "createdAt");

-- CreateIndex
CREATE INDEX "GeoAnalysis_tenantId_projectId_createdAt_idx" ON "GeoAnalysis"("tenantId", "projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GeoAnalysis_id_tenantId_key" ON "GeoAnalysis"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "GeoAnalysis_tenantId_requestKey_key" ON "GeoAnalysis"("tenantId", "requestKey");

-- CreateIndex
CREATE INDEX "GeoRun_tenantId_analysisId_status_idx" ON "GeoRun"("tenantId", "analysisId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GeoRun_analysisId_questionId_modelId_key" ON "GeoRun"("analysisId", "questionId", "modelId");

-- CreateIndex
CREATE INDEX "GeoSchedule_active_nextRunAt_idx" ON "GeoSchedule"("active", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "GeoSchedule_id_tenantId_key" ON "GeoSchedule"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "GeoSchedule_tenantId_requestKey_key" ON "GeoSchedule"("tenantId", "requestKey");

-- CreateIndex
CREATE INDEX "GeoScheduleExecution_status_retryAt_leaseUntil_idx" ON "GeoScheduleExecution"("status", "retryAt", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "GeoScheduleExecution_scheduleId_dueAt_key" ON "GeoScheduleExecution"("scheduleId", "dueAt");

-- CreateIndex
CREATE INDEX "GeoOptimization_tenantId_projectId_status_idx" ON "GeoOptimization"("tenantId", "projectId", "status");

-- AddForeignKey
ALTER TABLE "GeoQuestion" ADD CONSTRAINT "GeoQuestion_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "GeoProject"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoModelVersion" ADD CONSTRAINT "GeoModelVersion_modelId_tenantId_fkey" FOREIGN KEY ("modelId", "tenantId") REFERENCES "GeoModel"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoAnalysis" ADD CONSTRAINT "GeoAnalysis_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "GeoProject"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoRun" ADD CONSTRAINT "GeoRun_analysisId_tenantId_fkey" FOREIGN KEY ("analysisId", "tenantId") REFERENCES "GeoAnalysis"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoSchedule" ADD CONSTRAINT "GeoSchedule_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "GeoProject"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoScheduleExecution" ADD CONSTRAINT "GeoScheduleExecution_scheduleId_tenantId_fkey" FOREIGN KEY ("scheduleId", "tenantId") REFERENCES "GeoSchedule"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoOptimization" ADD CONSTRAINT "GeoOptimization_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "GeoProject"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

