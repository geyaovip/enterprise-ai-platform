ALTER TABLE "AiTask" ADD COLUMN "requestKey" TEXT;
CREATE UNIQUE INDEX "AiTask_tenantId_membershipId_requestKey_key" ON "AiTask"("tenantId", "membershipId", "requestKey");
CREATE TABLE "PersonalNotification" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "recipientMembershipId" TEXT NOT NULL,
 "appId" TEXT NOT NULL, "kind" TEXT NOT NULL, "resourceId" TEXT NOT NULL,
 "dedupeKey" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL,
 "readAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PersonalNotification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonalNotification_tenantId_recipientMembershipId_dedupeKey_key" ON "PersonalNotification"("tenantId", "recipientMembershipId", "dedupeKey");
CREATE INDEX "PersonalNotification_tenantId_recipientMembershipId_createdAt_idx" ON "PersonalNotification"("tenantId", "recipientMembershipId", "createdAt");
