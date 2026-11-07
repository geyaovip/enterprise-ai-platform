-- CreateTable
CREATE TABLE "ContentGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "ContentGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentSettings" (
    "tenantId" TEXT NOT NULL,
    "reviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "maxBatch" INTEGER NOT NULL DEFAULT 12,
    "monthlyImageLimit" INTEGER NOT NULL DEFAULT 100,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ContentSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "ContentDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedVersion" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentDocumentVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentProject" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "participants" TEXT[],
    "brief" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentAsset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "projectId" TEXT,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentArtifact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentArtifactVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT NOT NULL,
    "submittedBy" TEXT,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "reviewPolicyVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentArtifactVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentGenerationItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "input" JSONB NOT NULL,
    "artifactId" TEXT,
    "errorCode" TEXT,
    "lease" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentGenerationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentProviderAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'prepared',
    "externalId" TEXT,
    "resultAssetId" TEXT,
    "usage" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentProviderAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentExport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'preparing',
    "manifest" JSONB NOT NULL,
    "bytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentGrant_tenantId_membershipId_key" ON "ContentGrant"("tenantId", "membershipId");

-- CreateIndex
CREATE INDEX "ContentDocument_tenantId_kind_deletedAt_idx" ON "ContentDocument"("tenantId", "kind", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentDocumentVersion_tenantId_documentId_version_key" ON "ContentDocumentVersion"("tenantId", "documentId", "version");

-- CreateIndex
CREATE INDEX "ContentProject_tenantId_deletedAt_updatedAt_idx" ON "ContentProject"("tenantId", "deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "ContentAsset_tenantId_projectId_deletedAt_idx" ON "ContentAsset"("tenantId", "projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "ContentArtifact_tenantId_projectId_idx" ON "ContentArtifact"("tenantId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentArtifactVersion_tenantId_artifactId_version_key" ON "ContentArtifactVersion"("tenantId", "artifactId", "version");

-- CreateIndex
CREATE INDEX "ContentBatch_tenantId_projectId_idx" ON "ContentBatch"("tenantId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentBatch_tenantId_requestKey_key" ON "ContentBatch"("tenantId", "requestKey");

-- CreateIndex
CREATE INDEX "ContentGenerationItem_status_createdAt_idx" ON "ContentGenerationItem"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ContentGenerationItem_tenantId_batchId_idx" ON "ContentGenerationItem"("tenantId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentProviderAttempt_itemId_key" ON "ContentProviderAttempt"("itemId");

-- CreateIndex
CREATE INDEX "ContentProviderAttempt_tenantId_createdAt_idx" ON "ContentProviderAttempt"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentExport_tenantId_requestKey_key" ON "ContentExport"("tenantId", "requestKey");
