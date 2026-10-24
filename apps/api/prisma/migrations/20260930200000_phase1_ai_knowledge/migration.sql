-- AlterTable
ALTER TABLE "User" ADD COLUMN     "platformRole" TEXT;

-- AlterTable
ALTER TABLE "TenantApp" ADD COLUMN     "granted" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "TenantCapability" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "TenantCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "tenantId" TEXT,
    "resourceId" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfrastructureBinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfrastructureBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiExecution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "bindingId" TEXT,
    "bindingVersion" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'running',
    "externalId" TEXT,
    "errorCode" TEXT,
    "usage" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSpace" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "ownerMembershipId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'restricted',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeSpace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "access" TEXT NOT NULL,

    CONSTRAINT "KnowledgeGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocumentVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeIndex" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "bindingVersion" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "datasetId" TEXT,
    "externalDocumentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "errorCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeCitation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "locator" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeCitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantCapability_tenantId_capability_key" ON "TenantCapability"("tenantId", "capability");

-- CreateIndex
CREATE INDEX "OperatorAudit_tenantId_createdAt_idx" ON "OperatorAudit"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InfrastructureBinding_tenantId_kind_scopeKey_key" ON "InfrastructureBinding"("tenantId", "kind", "scopeKey");

-- CreateIndex
CREATE INDEX "AiExecution_tenantId_membershipId_sessionId_createdAt_idx" ON "AiExecution"("tenantId", "membershipId", "sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeSpace_tenantId_active_idx" ON "KnowledgeSpace"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSpace_id_tenantId_key" ON "KnowledgeSpace"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeGrant_spaceId_subjectType_subjectId_key" ON "KnowledgeGrant"("spaceId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_tenantId_spaceId_status_idx" ON "KnowledgeDocument"("tenantId", "spaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDocument_id_tenantId_key" ON "KnowledgeDocument"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDocumentVersion_documentId_version_key" ON "KnowledgeDocumentVersion"("documentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDocumentVersion_id_tenantId_key" ON "KnowledgeDocumentVersion"("id", "tenantId");

-- CreateIndex
CREATE INDEX "KnowledgeIndex_status_updatedAt_idx" ON "KnowledgeIndex"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeIndex_versionId_bindingId_bindingVersion_key" ON "KnowledgeIndex"("versionId", "bindingId", "bindingVersion");

-- CreateIndex
CREATE INDEX "KnowledgeCitation_tenantId_versionId_idx" ON "KnowledgeCitation"("tenantId", "versionId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCitation_versionId_contentHash_key" ON "KnowledgeCitation"("versionId", "contentHash");

-- AddForeignKey
ALTER TABLE "KnowledgeGrant" ADD CONSTRAINT "KnowledgeGrant_spaceId_tenantId_fkey" FOREIGN KEY ("spaceId", "tenantId") REFERENCES "KnowledgeSpace"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_spaceId_tenantId_fkey" FOREIGN KEY ("spaceId", "tenantId") REFERENCES "KnowledgeSpace"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocumentVersion" ADD CONSTRAINT "KnowledgeDocumentVersion_documentId_tenantId_fkey" FOREIGN KEY ("documentId", "tenantId") REFERENCES "KnowledgeDocument"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeIndex" ADD CONSTRAINT "KnowledgeIndex_versionId_tenantId_fkey" FOREIGN KEY ("versionId", "tenantId") REFERENCES "KnowledgeDocumentVersion"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCitation" ADD CONSTRAINT "KnowledgeCitation_versionId_tenantId_fkey" FOREIGN KEY ("versionId", "tenantId") REFERENCES "KnowledgeDocumentVersion"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing tenant entitlements are preserved; new tenants are provisioned explicitly.
INSERT INTO "TenantCapability" ("id", "tenantId", "capability", "delivered", "enabled", "version")
SELECT md5(t."id" || ':' || c.capability), t."id", c.capability, true, true, 1 FROM "Tenant" t CROSS JOIN (VALUES ('ai'), ('knowledge')) AS c(capability);
