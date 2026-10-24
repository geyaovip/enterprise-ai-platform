-- CreateTable
CREATE TABLE "CrmSettings" (
    "tenantId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "windowDays" INTEGER NOT NULL DEFAULT 90,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "metricPolicyVersion" INTEGER NOT NULL DEFAULT 1,
    "dataRevision" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "CrmMemberGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "scopeBindings" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmMemberGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmMemberPermissionGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "scopeBindings" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmMemberPermissionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSalesChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'manual_import',
    "defaultOrgUnitId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSalesChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmScopeRevision" (
    "channelId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceRevision" INTEGER NOT NULL DEFAULT 0,
    "customerRuleRevision" INTEGER NOT NULL DEFAULT 0,
    "publishedSourceRevision" INTEGER NOT NULL DEFAULT -1,
    "publishedRuleRevision" INTEGER NOT NULL DEFAULT -1,
    "metricGenerationId" TEXT,
    "metricAsOf" TIMESTAMP(3),
    "metricStatus" TEXT NOT NULL DEFAULT 'queued',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmScopeRevision_pkey" PRIMARY KEY ("channelId")
);

-- CreateTable
CREATE TABLE "CrmCustomer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sourceCreatedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "sourceHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCustomerIdentity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalCustomerId" TEXT NOT NULL,
    "sourceRevision" TEXT,

    CONSTRAINT "CrmCustomerIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCustomerContact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "maskedValue" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,

    CONSTRAINT "CrmCustomerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCommerceOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paidAmount" DECIMAL(20,2) NOT NULL,
    "refundAmount" DECIMAL(20,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "unallocatedPaidAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "unallocatedRefundAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "unallocatedReason" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "sourceRevision" TEXT,
    "sourceHash" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "compensated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmCommerceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCommerceOrderItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "externalLineId" TEXT,
    "externalSkuId" TEXT NOT NULL,
    "name" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL,
    "paidAmount" DECIMAL(20,2) NOT NULL,
    "refundAmount" DECIMAL(20,2) NOT NULL,

    CONSTRAINT "CrmCommerceOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCustomerTag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CrmCustomerTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCustomerTagAssignment" (
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',

    CONSTRAINT "CrmCustomerTagAssignment_pkey" PRIMARY KEY ("tenantId","customerId","tagId","source")
);

-- CreateTable
CREATE TABLE "CrmMetricSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSegment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rule" JSONB NOT NULL,
    "ruleHash" TEXT NOT NULL,
    "templateId" TEXT,
    "templateVersion" INTEGER,
    "ownerMembershipId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSegmentEvaluation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "segmentId" TEXT,
    "segmentVersion" INTEGER,
    "createdByMembershipId" TEXT NOT NULL,
    "rule" JSONB NOT NULL,
    "ruleHash" TEXT NOT NULL,
    "previewHash" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "dataRevision" INTEGER NOT NULL,
    "dependencyVersions" JSONB NOT NULL,
    "scopeFingerprint" TEXT NOT NULL,
    "metricGenerationId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "memberHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "usableForTask" BOOLEAN NOT NULL,
    "invalidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmSegmentEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSegmentMember" (
    "tenantId" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,

    CONSTRAINT "CrmSegmentMember_pkey" PRIMARY KEY ("tenantId","evaluationId","customerId")
);

-- CreateTable
CREATE TABLE "CrmOperationTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "creatorMembershipId" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "dueAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "evaluationId" TEXT,
    "savedRule" JSONB,
    "currentPlanVersion" INTEGER NOT NULL DEFAULT 1,
    "confirmedPlanVersion" INTEGER,
    "submittedPlanVersion" INTEGER,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "baselineStart" TIMESTAMP(3),
    "baselineEnd" TIMESTAMP(3),
    "observationStart" TIMESTAMP(3),
    "observationEnd" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "relatedTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmOperationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmTaskPlanVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "planVersion" INTEGER NOT NULL,
    "planText" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "hypotheses" JSONB NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "aiInvocationId" TEXT,
    "skillVersion" TEXT,
    "factReferences" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmTaskPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmOperationTaskLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorMembershipId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "checklistItemIds" JSONB NOT NULL,
    "correctsLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmOperationTaskLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmImportBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "creatorMembershipId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "mapping" JSONB NOT NULL,
    "mappingVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "rowCounts" JSONB NOT NULL DEFAULT '{}',
    "objectCounts" JSONB NOT NULL DEFAULT '{}',
    "scopePairs" JSONB NOT NULL,
    "fileSetHash" TEXT,
    "previewHash" TEXT,
    "previewContext" JSONB,
    "metricsStatus" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmImportFile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "fileRef" TEXT,
    "fileHash" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmImportFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmImportRow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "groupKey" TEXT NOT NULL,
    "payloadCiphertext" TEXT,
    "rowHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "targetId" TEXT,
    "outcome" TEXT,
    "errorCode" TEXT,
    "errorFields" JSONB NOT NULL DEFAULT '[]',
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CrmImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmImportChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "beforeCiphertext" TEXT,
    "afterVersion" INTEGER NOT NULL,
    "compensatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmImportChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCommandReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmCommandReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiComposerDraft" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "contentCiphertext" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiComposerDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmMemberGrant_tenantId_membershipId_active_idx" ON "CrmMemberGrant"("tenantId", "membershipId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CrmMemberGrant_tenantId_membershipId_role_key" ON "CrmMemberGrant"("tenantId", "membershipId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "CrmMemberPermissionGrant_tenantId_membershipId_permission_key" ON "CrmMemberPermissionGrant"("tenantId", "membershipId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "CrmSalesChannel_id_tenantId_key" ON "CrmSalesChannel"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmSalesChannel_tenantId_code_key" ON "CrmSalesChannel"("tenantId", "code");

-- CreateIndex
CREATE INDEX "CrmScopeRevision_tenantId_metricStatus_idx" ON "CrmScopeRevision"("tenantId", "metricStatus");

-- CreateIndex
CREATE UNIQUE INDEX "CrmScopeRevision_channelId_tenantId_key" ON "CrmScopeRevision"("channelId", "tenantId");

-- CreateIndex
CREATE INDEX "CrmCustomer_tenantId_orgUnitId_status_idx" ON "CrmCustomer"("tenantId", "orgUnitId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCustomer_id_tenantId_key" ON "CrmCustomer"("id", "tenantId");

-- CreateIndex
CREATE INDEX "CrmCustomerIdentity_tenantId_customerId_idx" ON "CrmCustomerIdentity"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCustomerIdentity_tenantId_channelId_externalCustomerId_key" ON "CrmCustomerIdentity"("tenantId", "channelId", "externalCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCustomerContact_tenantId_customerId_type_key" ON "CrmCustomerContact"("tenantId", "customerId", "type");

-- CreateIndex
CREATE INDEX "CrmCommerceOrder_tenantId_customerId_paidAt_idx" ON "CrmCommerceOrder"("tenantId", "customerId", "paidAt");

-- CreateIndex
CREATE INDEX "CrmCommerceOrder_tenantId_channelId_paidAt_idx" ON "CrmCommerceOrder"("tenantId", "channelId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCommerceOrder_id_tenantId_key" ON "CrmCommerceOrder"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCommerceOrder_tenantId_channelId_externalOrderId_key" ON "CrmCommerceOrder"("tenantId", "channelId", "externalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCommerceOrderItem_tenantId_orderId_lineKey_key" ON "CrmCommerceOrderItem"("tenantId", "orderId", "lineKey");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCustomerTag_id_tenantId_key" ON "CrmCustomerTag"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCustomerTag_tenantId_code_key" ON "CrmCustomerTag"("tenantId", "code");

-- CreateIndex
CREATE INDEX "CrmMetricSnapshot_tenantId_channelId_generationId_idx" ON "CrmMetricSnapshot"("tenantId", "channelId", "generationId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmMetricSnapshot_tenantId_customerId_channelId_generationI_key" ON "CrmMetricSnapshot"("tenantId", "customerId", "channelId", "generationId", "currency");

-- CreateIndex
CREATE INDEX "CrmSegment_tenantId_ownerMembershipId_status_idx" ON "CrmSegment"("tenantId", "ownerMembershipId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CrmSegment_id_tenantId_key" ON "CrmSegment"("id", "tenantId");

-- CreateIndex
CREATE INDEX "CrmSegmentEvaluation_tenantId_segmentId_createdAt_idx" ON "CrmSegmentEvaluation"("tenantId", "segmentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmSegmentEvaluation_id_tenantId_key" ON "CrmSegmentEvaluation"("id", "tenantId");

-- CreateIndex
CREATE INDEX "CrmOperationTask_tenantId_ownerMembershipId_status_dueAt_idx" ON "CrmOperationTask"("tenantId", "ownerMembershipId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmOperationTask_id_tenantId_key" ON "CrmOperationTask"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmTaskPlanVersion_tenantId_taskId_planVersion_key" ON "CrmTaskPlanVersion"("tenantId", "taskId", "planVersion");

-- CreateIndex
CREATE INDEX "CrmOperationTaskLog_tenantId_taskId_occurredAt_idx" ON "CrmOperationTaskLog"("tenantId", "taskId", "occurredAt");

-- CreateIndex
CREATE INDEX "CrmImportBatch_tenantId_status_createdAt_idx" ON "CrmImportBatch"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmImportBatch_id_tenantId_key" ON "CrmImportBatch"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmImportFile_id_tenantId_key" ON "CrmImportFile"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmImportFile_tenantId_batchId_role_key" ON "CrmImportFile"("tenantId", "batchId", "role");

-- CreateIndex
CREATE INDEX "CrmImportRow_tenantId_batchId_groupKey_status_idx" ON "CrmImportRow"("tenantId", "batchId", "groupKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CrmImportRow_tenantId_batchId_fileId_sheetName_rowNumber_key" ON "CrmImportRow"("tenantId", "batchId", "fileId", "sheetName", "rowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CrmImportChange_tenantId_batchId_targetType_targetId_key" ON "CrmImportChange"("tenantId", "batchId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCommandReceipt_tenantId_membershipId_command_requestKey_key" ON "CrmCommandReceipt"("tenantId", "membershipId", "command", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiComposerDraft_tenantId_userId_appId_key" ON "AiComposerDraft"("tenantId", "userId", "appId");

-- AddForeignKey
ALTER TABLE "CrmScopeRevision" ADD CONSTRAINT "CrmScopeRevision_channelId_tenantId_fkey" FOREIGN KEY ("channelId", "tenantId") REFERENCES "CrmSalesChannel"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCustomerIdentity" ADD CONSTRAINT "CrmCustomerIdentity_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "CrmCustomer"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCustomerIdentity" ADD CONSTRAINT "CrmCustomerIdentity_channelId_tenantId_fkey" FOREIGN KEY ("channelId", "tenantId") REFERENCES "CrmSalesChannel"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCustomerContact" ADD CONSTRAINT "CrmCustomerContact_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "CrmCustomer"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCommerceOrder" ADD CONSTRAINT "CrmCommerceOrder_channelId_tenantId_fkey" FOREIGN KEY ("channelId", "tenantId") REFERENCES "CrmSalesChannel"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCommerceOrder" ADD CONSTRAINT "CrmCommerceOrder_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "CrmCustomer"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCommerceOrderItem" ADD CONSTRAINT "CrmCommerceOrderItem_orderId_tenantId_fkey" FOREIGN KEY ("orderId", "tenantId") REFERENCES "CrmCommerceOrder"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCustomerTagAssignment" ADD CONSTRAINT "CrmCustomerTagAssignment_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "CrmCustomer"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCustomerTagAssignment" ADD CONSTRAINT "CrmCustomerTagAssignment_tagId_tenantId_fkey" FOREIGN KEY ("tagId", "tenantId") REFERENCES "CrmCustomerTag"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmMetricSnapshot" ADD CONSTRAINT "CrmMetricSnapshot_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "CrmCustomer"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmMetricSnapshot" ADD CONSTRAINT "CrmMetricSnapshot_channelId_tenantId_fkey" FOREIGN KEY ("channelId", "tenantId") REFERENCES "CrmSalesChannel"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSegmentEvaluation" ADD CONSTRAINT "CrmSegmentEvaluation_segmentId_tenantId_fkey" FOREIGN KEY ("segmentId", "tenantId") REFERENCES "CrmSegment"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSegmentMember" ADD CONSTRAINT "CrmSegmentMember_evaluationId_tenantId_fkey" FOREIGN KEY ("evaluationId", "tenantId") REFERENCES "CrmSegmentEvaluation"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSegmentMember" ADD CONSTRAINT "CrmSegmentMember_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "CrmCustomer"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOperationTask" ADD CONSTRAINT "CrmOperationTask_evaluationId_tenantId_fkey" FOREIGN KEY ("evaluationId", "tenantId") REFERENCES "CrmSegmentEvaluation"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTaskPlanVersion" ADD CONSTRAINT "CrmTaskPlanVersion_taskId_tenantId_fkey" FOREIGN KEY ("taskId", "tenantId") REFERENCES "CrmOperationTask"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOperationTaskLog" ADD CONSTRAINT "CrmOperationTaskLog_taskId_tenantId_fkey" FOREIGN KEY ("taskId", "tenantId") REFERENCES "CrmOperationTask"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmImportBatch" ADD CONSTRAINT "CrmImportBatch_channelId_tenantId_fkey" FOREIGN KEY ("channelId", "tenantId") REFERENCES "CrmSalesChannel"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmImportFile" ADD CONSTRAINT "CrmImportFile_batchId_tenantId_fkey" FOREIGN KEY ("batchId", "tenantId") REFERENCES "CrmImportBatch"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmImportRow" ADD CONSTRAINT "CrmImportRow_batchId_tenantId_fkey" FOREIGN KEY ("batchId", "tenantId") REFERENCES "CrmImportBatch"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmImportRow" ADD CONSTRAINT "CrmImportRow_fileId_tenantId_fkey" FOREIGN KEY ("fileId", "tenantId") REFERENCES "CrmImportFile"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmImportChange" ADD CONSTRAINT "CrmImportChange_batchId_tenantId_fkey" FOREIGN KEY ("batchId", "tenantId") REFERENCES "CrmImportBatch"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

