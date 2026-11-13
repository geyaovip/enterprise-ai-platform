CREATE TABLE "ContentMediaJob" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "input" JSONB NOT NULL,
  "checkpoint" JSONB NOT NULL,
  "error" TEXT,
  "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentMediaJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentMediaJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "ContentMediaJob_tenantId_membershipId_requestKey_key" ON "ContentMediaJob"("tenantId", "membershipId", "requestKey");
CREATE INDEX "ContentMediaJob_tenantId_membershipId_kind_createdAt_idx" ON "ContentMediaJob"("tenantId", "membershipId", "kind", "createdAt");
CREATE INDEX "ContentMediaJob_status_nextRunAt_idx" ON "ContentMediaJob"("status", "nextRunAt");
