ALTER TABLE "ErpBusinessSettings" ADD COLUMN "workflowConfig" JSONB NOT NULL DEFAULT '{}';
CREATE TABLE "ErpWorkflow" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "kind" TEXT NOT NULL, "resourceId" TEXT NOT NULL,
 "parentResourceId" TEXT, "resourceNumber" TEXT NOT NULL, "title" TEXT NOT NULL, "initiatedByMembershipId" TEXT NOT NULL,
 "templateVersion" INTEGER NOT NULL, "rules" JSONB NOT NULL, "steps" JSONB NOT NULL, "events" JSONB NOT NULL DEFAULT '[]',
 "cursor" INTEGER NOT NULL DEFAULT 0, "cycle" INTEGER NOT NULL DEFAULT 1, "status" TEXT NOT NULL DEFAULT 'active',
 "dueAt" TIMESTAMP(3), "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ErpWorkflow_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ErpWorkflow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ErpWorkflow_tenantId_kind_resourceId_key" ON "ErpWorkflow"("tenantId","kind","resourceId");
CREATE INDEX "ErpWorkflow_tenantId_status_dueAt_idx" ON "ErpWorkflow"("tenantId","status","dueAt");
