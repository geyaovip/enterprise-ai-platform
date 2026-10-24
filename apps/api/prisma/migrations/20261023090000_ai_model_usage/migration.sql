CREATE TABLE "AiModelUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT,
    "appId" TEXT NOT NULL,
    "sessionId" TEXT,
    "requestId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'started',
    "usageStatus" TEXT NOT NULL DEFAULT 'pending',
    "model" TEXT,
    "requestedModel" TEXT,
    "externalId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "cacheWriteTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "purpose" TEXT NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "AiModelUsage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiModelUsage_tenantId_appId_createdAt_idx" ON "AiModelUsage"("tenantId", "appId", "createdAt");
CREATE INDEX "AiModelUsage_model_createdAt_idx" ON "AiModelUsage"("model", "createdAt");
