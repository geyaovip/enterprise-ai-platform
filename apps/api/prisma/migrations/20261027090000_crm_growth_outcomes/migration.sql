-- Additive; old task completion behavior is retained until explicitly enabled in a draft.
ALTER TABLE "CrmOperationTask" ADD COLUMN "trackCustomers" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CrmOperationTaskLog" ADD COLUMN "customerId" TEXT, ADD COLUMN "outcome" TEXT, ADD COLUMN "outcomeVersion" INTEGER, ADD COLUMN "nextAt" TIMESTAMP(3);
ALTER TABLE "CrmOperationTaskLog" ADD CONSTRAINT "CrmOperationTaskLog_customer_tenant_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "CrmCustomer"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrmOperationTaskLog" ADD CONSTRAINT "CrmOperationTaskLog_outcome_check" CHECK (("customerId" IS NULL AND "outcome" IS NULL AND "outcomeVersion" IS NULL AND "nextAt" IS NULL) OR ("customerId" IS NOT NULL AND "outcome" IS NOT NULL AND "outcomeVersion" IS NOT NULL AND "outcome" IN ('contacted','unreachable','interested','declined','follow_up','skipped') AND "outcomeVersion" > 0));
CREATE UNIQUE INDEX "CrmOperationTaskLog_tenantId_taskId_customerId_outcomeVersion_key" ON "CrmOperationTaskLog"("tenantId", "taskId", "customerId", "outcomeVersion");
