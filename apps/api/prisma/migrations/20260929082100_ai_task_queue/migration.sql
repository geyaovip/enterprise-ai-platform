-- CreateTable
CREATE TABLE "AiTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "result" JSONB,
    "errorCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiTask_status_createdAt_idx" ON "AiTask"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AiTask_tenantId_userId_appId_createdAt_idx" ON "AiTask"("tenantId", "userId", "appId", "createdAt");
