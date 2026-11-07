BEGIN;
-- AlterTable
ALTER TABLE "CrmCustomer" ADD COLUMN     "industry" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'consumer',
ADD COLUMN     "ownerMembershipId" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "registrationId" TEXT,
ADD COLUMN     "serviceOwnerMembershipId" TEXT;

-- CreateTable
CREATE TABLE "CrmLead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "companyName" TEXT,
    "contactCiphertext" TEXT,
    "contactMasked" TEXT,
    "contactDigest" TEXT,
    "source" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "ownerMembershipId" TEXT,
    "customerId" TEXT,
    "convertedOpportunityId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSalesPool" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "memberIds" JSONB NOT NULL,
    "nextIndex" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmSalesPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmBusinessContact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "contactCiphertext" TEXT NOT NULL,
    "maskedValue" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "preferred" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmBusinessContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmOpportunity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'new',
    "stage" TEXT NOT NULL DEFAULT 'discovery',
    "ownerMembershipId" TEXT NOT NULL,
    "participantMembershipIds" JSONB NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "estimatedAmount" DECIMAL(18,2) NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 10,
    "expectedCloseAt" TIMESTAMP(3),
    "actualAmount" DECIMAL(18,2),
    "actualCloseAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "nextAction" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmFollowUp" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "authorMembershipId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "nextAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "correctsId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmServicePlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerMembershipId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmServicePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmServiceTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "assigneeMembershipId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "completionNote" TEXT,
    "reviewReason" TEXT,
    "submittedBy" TEXT,
    "reviewedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmServiceTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmServiceRisk" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "ownerMembershipId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "CrmServiceRisk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmLead_tenantId_orgUnitId_channelId_status_idx" ON "CrmLead"("tenantId", "orgUnitId", "channelId", "status");

-- CreateIndex
CREATE INDEX "CrmLead_tenantId_ownerMembershipId_status_idx" ON "CrmLead"("tenantId", "ownerMembershipId", "status");

-- CreateIndex
CREATE INDEX "CrmLead_tenantId_contactDigest_idx" ON "CrmLead"("tenantId", "contactDigest");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLead_id_tenantId_key" ON "CrmLead"("id", "tenantId");

-- CreateIndex
CREATE INDEX "CrmSalesPool_tenantId_orgUnitId_channelId_idx" ON "CrmSalesPool"("tenantId", "orgUnitId", "channelId");

-- CreateIndex
CREATE INDEX "CrmBusinessContact_tenantId_customerId_idx" ON "CrmBusinessContact"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "CrmOpportunity_tenantId_orgUnitId_channelId_stage_idx" ON "CrmOpportunity"("tenantId", "orgUnitId", "channelId", "stage");

-- CreateIndex
CREATE INDEX "CrmOpportunity_tenantId_ownerMembershipId_idx" ON "CrmOpportunity"("tenantId", "ownerMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmOpportunity_id_tenantId_key" ON "CrmOpportunity"("id", "tenantId");

-- CreateIndex
CREATE INDEX "CrmFollowUp_tenantId_targetType_targetId_idx" ON "CrmFollowUp"("tenantId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "CrmFollowUp_tenantId_authorMembershipId_nextAt_idx" ON "CrmFollowUp"("tenantId", "authorMembershipId", "nextAt");

-- CreateIndex
CREATE INDEX "CrmServicePlan_tenantId_orgUnitId_channelId_status_idx" ON "CrmServicePlan"("tenantId", "orgUnitId", "channelId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CrmServicePlan_id_tenantId_key" ON "CrmServicePlan"("id", "tenantId");

-- CreateIndex
CREATE INDEX "CrmServiceTask_tenantId_assigneeMembershipId_status_idx" ON "CrmServiceTask"("tenantId", "assigneeMembershipId", "status");

-- CreateIndex
CREATE INDEX "CrmServiceRisk_tenantId_orgUnitId_channelId_status_idx" ON "CrmServiceRisk"("tenantId", "orgUnitId", "channelId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCustomer_tenantId_registrationId_key" ON "CrmCustomer"("tenantId", "registrationId");

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "CrmCustomer"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmBusinessContact" ADD CONSTRAINT "CrmBusinessContact_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "CrmCustomer"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "CrmCustomer"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmServicePlan" ADD CONSTRAINT "CrmServicePlan_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "CrmCustomer"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmServiceTask" ADD CONSTRAINT "CrmServiceTask_planId_tenantId_fkey" FOREIGN KEY ("planId", "tenantId") REFERENCES "CrmServicePlan"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmServiceRisk" ADD CONSTRAINT "CrmServiceRisk_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "CrmCustomer"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_probability_check" CHECK ("probability" BETWEEN 0 AND 100), ADD CONSTRAINT "CrmOpportunity_amount_check" CHECK ("estimatedAmount">=0 AND ("actualAmount" IS NULL OR "actualAmount">=0));
ALTER TABLE "CrmServicePlan" ADD CONSTRAINT "CrmServicePlan_dates_check" CHECK ("endsAt">"startsAt");
COMMIT;
