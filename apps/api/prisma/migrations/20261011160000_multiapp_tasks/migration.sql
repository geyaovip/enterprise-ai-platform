-- CreateTable
CREATE TABLE "BusinessTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'workflow',
    "input" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "version" INTEGER NOT NULL DEFAULT 1,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leasedUntil" TIMESTAMP(3),
    "wakeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessTaskStep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "appId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BusinessTaskStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationOutbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "sourceApp" TEXT NOT NULL,
    "targetApp" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "requestKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leasedUntil" TIMESTAMP(3),
    "wakeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationCommandReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationCommandReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationObjectLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceApp" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetApp" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationObjectLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpOperatingEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "ownerMembershipId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "version" INTEGER NOT NULL DEFAULT 1,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpOperatingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePlan" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appIds" JSONB NOT NULL,
    "seatLimit" INTEGER NOT NULL,
    "aiRunLimit" INTEGER NOT NULL,
    "taskLimit" INTEGER NOT NULL,
    "knowledgeBytes" BIGINT NOT NULL,
    "monthlyPrice" DECIMAL(18,2) NOT NULL,
    "inputTokenPrice" DECIMAL(18,6),
    "outputTokenPrice" DECIMAL(18,6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePlan_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "TenantSubscription" (
    "tenantId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "planVersion" INTEGER NOT NULL,
    "entitlement" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSubscription_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "detail" JSONB,
    "cost" DECIMAL(18,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualBill" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "status" TEXT NOT NULL DEFAULT 'issued',
    "note" TEXT NOT NULL,
    "paymentReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operatorUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "approvedBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessTask_status_wakeAt_leasedUntil_idx" ON "BusinessTask"("status", "wakeAt", "leasedUntil");

-- CreateIndex
CREATE INDEX "BusinessTask_tenantId_membershipId_createdAt_idx" ON "BusinessTask"("tenantId", "membershipId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessTask_tenantId_membershipId_requestKey_key" ON "BusinessTask"("tenantId", "membershipId", "requestKey");

-- CreateIndex
CREATE INDEX "BusinessTaskStep_tenantId_taskId_idx" ON "BusinessTaskStep"("tenantId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessTaskStep_taskId_ordinal_key" ON "BusinessTaskStep"("taskId", "ordinal");

-- CreateIndex
CREATE INDEX "ApplicationOutbox_status_wakeAt_leasedUntil_idx" ON "ApplicationOutbox"("status", "wakeAt", "leasedUntil");

-- CreateIndex
CREATE INDEX "ApplicationOutbox_tenantId_sourceApp_createdAt_idx" ON "ApplicationOutbox"("tenantId", "sourceApp", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationOutbox_tenantId_sourceApp_requestKey_key" ON "ApplicationOutbox"("tenantId", "sourceApp", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationCommandReceipt_tenantId_appId_requestKey_key" ON "ApplicationCommandReceipt"("tenantId", "appId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationObjectLink_tenantId_sourceApp_sourceType_sourceI_key" ON "ApplicationObjectLink"("tenantId", "sourceApp", "sourceType", "sourceId", "targetApp", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "ErpOperatingEvent_tenantId_ownerMembershipId_status_idx" ON "ErpOperatingEvent"("tenantId", "ownerMembershipId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ErpOperatingEvent_tenantId_kind_sourceId_key" ON "ErpOperatingEvent"("tenantId", "kind", "sourceId");

-- CreateIndex
CREATE INDEX "UsageRecord_tenantId_metric_createdAt_idx" ON "UsageRecord"("tenantId", "metric", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRecord_tenantId_metric_requestKey_key" ON "UsageRecord"("tenantId", "metric", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ManualBill_tenantId_number_key" ON "ManualBill"("tenantId", "number");

-- CreateIndex
CREATE INDEX "SupportGrant_tenantId_status_idx" ON "SupportGrant"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "BusinessTaskStep" ADD CONSTRAINT "BusinessTaskStep_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "BusinessTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
