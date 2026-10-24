ALTER TABLE "AiModelUsage" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "AiModelUsage" ADD COLUMN "batchId" TEXT;
