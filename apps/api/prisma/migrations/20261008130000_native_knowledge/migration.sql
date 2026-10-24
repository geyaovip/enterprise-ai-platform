-- CreateTable
CREATE TABLE "KnowledgeEngineProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeEngineProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeEngineTransition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "targetVersion" INTEGER NOT NULL,
    "targetSnapshot" JSONB NOT NULL,
    "previousSnapshot" JSONB NOT NULL,
    "profileVersion" INTEGER,
    "createdByMembershipId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'building',
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeEngineTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NativeKnowledgeDataset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "generation" INTEGER NOT NULL DEFAULT 0,
    "dimension" INTEGER,
    "embeddingModel" TEXT NOT NULL,

    CONSTRAINT "NativeKnowledgeDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NativeKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "locator" JSONB NOT NULL,
    "embedding" REAL[],

    CONSTRAINT "NativeKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeEngineProfile_tenantId_provider_key" ON "KnowledgeEngineProfile"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "KnowledgeEngineTransition_tenantId_createdAt_idx" ON "KnowledgeEngineTransition"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NativeKnowledgeDataset_id_tenantId_key" ON "NativeKnowledgeDataset"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "NativeKnowledgeChunk_datasetId_ordinal_key" ON "NativeKnowledgeChunk"("datasetId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeIndex_id_tenantId_key" ON "KnowledgeIndex"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "NativeKnowledgeDataset" ADD CONSTRAINT "NativeKnowledgeDataset_id_tenantId_fkey" FOREIGN KEY ("id", "tenantId") REFERENCES "KnowledgeIndex"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeKnowledgeChunk" ADD CONSTRAINT "NativeKnowledgeChunk_datasetId_tenantId_fkey" FOREIGN KEY ("datasetId", "tenantId") REFERENCES "NativeKnowledgeDataset"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE UNIQUE INDEX "KnowledgeEngineTransition_one_building" ON "KnowledgeEngineTransition" ("tenantId") WHERE "status" = 'building';
