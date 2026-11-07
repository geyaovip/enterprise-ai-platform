CREATE TABLE "ContentCanvas" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentCanvas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentCanvas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ContentCanvas_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ContentProject"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "ContentCanvas_projectId_key" ON "ContentCanvas"("projectId");
CREATE INDEX "ContentCanvas_tenantId_updatedAt_idx" ON "ContentCanvas"("tenantId", "updatedAt");
