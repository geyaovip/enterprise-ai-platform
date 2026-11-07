ALTER TABLE "GeoOptimization" ADD COLUMN "sourceRunId" TEXT;
CREATE INDEX "GeoOptimization_tenantId_assigneeMembershipId_status_idx" ON "GeoOptimization"("tenantId", "assigneeMembershipId", "status");
