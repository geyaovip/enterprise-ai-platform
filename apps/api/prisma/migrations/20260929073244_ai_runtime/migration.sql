-- CreateTable
CREATE TABLE "AiProviderSettings" (
    "tenantId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "keyCiphertext" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "title" TEXT NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "confirmationRequired" BOOLEAN NOT NULL,
    "result" JSONB,
    "errorCode" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiConversation_tenantId_userId_appId_updatedAt_idx" ON "AiConversation"("tenantId", "userId", "appId", "updatedAt");

-- CreateIndex
CREATE INDEX "AiAction_tenantId_userId_status_createdAt_idx" ON "AiAction"("tenantId", "userId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiAction_tenantId_idempotencyKey_key" ON "AiAction"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AiUsage_tenantId_appId_createdAt_idx" ON "AiUsage"("tenantId", "appId", "createdAt");
