ALTER TABLE "AiModelUsage" ADD COLUMN "reservedTokens" INTEGER;
ALTER TABLE "KnowledgeIndex" ADD COLUMN "modelAttemptId" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
CREATE INDEX "AiModelUsage_requestId_source_idx" ON "AiModelUsage"("requestId", "source");
