CREATE TABLE "ErpPurchaseChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "reviewReason" TEXT,
    "before" JSONB NOT NULL,
    "proposed" JSONB NOT NULL,
    "requestedByMembershipId" TEXT NOT NULL,
    "reviewedByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    CONSTRAINT "ErpPurchaseChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ErpPurchaseChange_tenantId_orderId_createdAt_idx" ON "ErpPurchaseChange"("tenantId", "orderId", "createdAt");
CREATE INDEX "ErpPurchaseChange_tenantId_status_createdAt_idx" ON "ErpPurchaseChange"("tenantId", "status", "createdAt");
ALTER TABLE "ErpPurchaseChange" ADD CONSTRAINT "ErpPurchaseChange_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ErpPurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
