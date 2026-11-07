CREATE TABLE "AiChatTurn" (
    "userId" TEXT NOT NULL,
    "turnKey" TEXT NOT NULL,
    "taskId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiChatTurn_pkey" PRIMARY KEY ("userId", "turnKey"),
    CONSTRAINT "AiChatTurn_status_check" CHECK ("status" IN ('reserved', 'consumed', 'released'))
);
CREATE UNIQUE INDEX "AiChatTurn_taskId_key" ON "AiChatTurn"("taskId");
CREATE INDEX "AiChatTurn_userId_status_idx" ON "AiChatTurn"("userId", "status");
