ALTER TABLE "ErpCustomer" ALTER COLUMN "ownerMembershipId" DROP NOT NULL;

CREATE TABLE "ErpOpportunityFollowup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "actorMembershipId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "nextActionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErpOpportunityFollowup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ErpOpportunityFollowup_tenantId_opportunityId_createdAt_idx" ON "ErpOpportunityFollowup"("tenantId", "opportunityId", "createdAt");
CREATE INDEX "ErpOpportunityFollowup_tenantId_nextActionAt_idx" ON "ErpOpportunityFollowup"("tenantId", "nextActionAt");
ALTER TABLE "ErpOpportunityFollowup" ADD CONSTRAINT "ErpOpportunityFollowup_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "ErpOpportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
