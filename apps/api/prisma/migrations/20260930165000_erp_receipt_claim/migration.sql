CREATE TABLE "ErpIncomingReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "allocatedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "version" INTEGER NOT NULL DEFAULT 1,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "registeredByMembershipId" TEXT NOT NULL,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpIncomingReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ErpReceiptClaim" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "amount" DECIMAL(18,2) NOT NULL,
    "allocations" JSONB NOT NULL,
    "requestedByMembershipId" TEXT NOT NULL,
    "reviewedByMembershipId" TEXT,
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    CONSTRAINT "ErpReceiptClaim_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ErpPayment" ADD COLUMN "receiptClaimId" TEXT;

CREATE UNIQUE INDEX "ErpIncomingReceipt_tenantId_reference_key" ON "ErpIncomingReceipt"("tenantId", "reference");
CREATE INDEX "ErpIncomingReceipt_tenantId_customerId_status_idx" ON "ErpIncomingReceipt"("tenantId", "customerId", "status");
CREATE INDEX "ErpReceiptClaim_tenantId_receiptId_status_idx" ON "ErpReceiptClaim"("tenantId", "receiptId", "status");
CREATE INDEX "ErpReceiptClaim_tenantId_status_createdAt_idx" ON "ErpReceiptClaim"("tenantId", "status", "createdAt");
CREATE INDEX "ErpPayment_receiptClaimId_idx" ON "ErpPayment"("receiptClaimId");
ALTER TABLE "ErpIncomingReceipt" ADD CONSTRAINT "ErpIncomingReceipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "ErpCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpReceiptClaim" ADD CONSTRAINT "ErpReceiptClaim_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "ErpIncomingReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPayment" ADD CONSTRAINT "ErpPayment_receiptClaimId_fkey" FOREIGN KEY ("receiptClaimId") REFERENCES "ErpReceiptClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;
