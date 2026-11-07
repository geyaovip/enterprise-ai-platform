ALTER TABLE "ContentExport" ADD COLUMN "userId" TEXT, ADD COLUMN "lease" TEXT, ADD COLUMN "heartbeatAt" TIMESTAMP(3), ADD COLUMN "errorCode" TEXT;
CREATE TABLE "ContentWorkDraft" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "artifactId" TEXT NOT NULL, "membershipId" TEXT NOT NULL,
 "baseVersion" INTEGER NOT NULL, "projectVersion" INTEGER NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
 "requestKey" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "data" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ContentWorkDraft_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ContentWorkDraft_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "ContentWorkDraft_tenantId_artifactId_membershipId_key" ON "ContentWorkDraft"("tenantId","artifactId","membershipId");
CREATE TABLE "ContentCopySuggestion" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "artifactId" TEXT NOT NULL, "membershipId" TEXT NOT NULL,
 "baseVersion" INTEGER NOT NULL, "projectVersion" INTEGER NOT NULL, "snapshotHash" TEXT NOT NULL,
 "requestKey" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "candidates" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ContentCopySuggestion_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ContentCopySuggestion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "ContentCopySuggestion_tenantId_requestKey_key" ON "ContentCopySuggestion"("tenantId","requestKey");
CREATE INDEX "ContentCopySuggestion_tenantId_artifactId_membershipId_creat_idx" ON "ContentCopySuggestion"("tenantId","artifactId","membershipId","createdAt");
CREATE INDEX "ContentExport_status_createdAt_idx" ON "ContentExport"("status","createdAt");
