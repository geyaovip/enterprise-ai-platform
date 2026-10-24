CREATE TABLE "AiContextSummary" (
 "conversationId" TEXT NOT NULL PRIMARY KEY,
 "coveredMessages" INTEGER NOT NULL,
 "sourceDigest" TEXT NOT NULL,
 "scopeDigest" TEXT NOT NULL,
 "content" TEXT NOT NULL,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "AiContextSummary_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "AiMemoryEntry" (
 "id" TEXT NOT NULL PRIMARY KEY,"tenantId" TEXT NOT NULL,"appId" TEXT NOT NULL,"ownerUserId" TEXT,"createdByUserId" TEXT NOT NULL,
 "visibility" TEXT NOT NULL,"kind" TEXT NOT NULL,"title" TEXT NOT NULL,"content" TEXT NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,
 "expiresAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AiMemoryEntry_tenantId_appId_ownerUserId_updatedAt_idx" ON "AiMemoryEntry"("tenantId","appId","ownerUserId","updatedAt");
CREATE TABLE "AiMemorySetting" (
 "tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL,"appId" TEXT NOT NULL,"enabled" BOOLEAN NOT NULL DEFAULT true,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "AiMemorySetting_pkey" PRIMARY KEY ("tenantId","userId","appId")
);

CREATE TABLE "AiMemoryIndexPurge" ("id" TEXT NOT NULL PRIMARY KEY,"tenantId" TEXT NOT NULL,"appId" TEXT NOT NULL,"userId" TEXT,"attempts" INTEGER NOT NULL DEFAULT 0,"nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "AiMemoryIndexPurge_nextAttemptAt_idx" ON "AiMemoryIndexPurge"("nextAttemptAt");
