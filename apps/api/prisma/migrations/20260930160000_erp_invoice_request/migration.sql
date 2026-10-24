CREATE TABLE "ErpInvoiceRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "note" TEXT,
    "requestedByMembershipId" TEXT NOT NULL,
    "reviewedByMembershipId" TEXT,
    "reviewReason" TEXT,
    "invoiceNumber" TEXT,
    "registeredAt" TIMESTAMP(3),
    "voidReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpInvoiceRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ErpInvoiceRequest_tenantId_invoiceNumber_key" ON "ErpInvoiceRequest"("tenantId", "invoiceNumber");
CREATE INDEX "ErpInvoiceRequest_tenantId_contractId_status_idx" ON "ErpInvoiceRequest"("tenantId", "contractId", "status");
CREATE INDEX "ErpInvoiceRequest_tenantId_status_createdAt_idx" ON "ErpInvoiceRequest"("tenantId", "status", "createdAt");
ALTER TABLE "ErpInvoiceRequest" ADD CONSTRAINT "ErpInvoiceRequest_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ErpSalesContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
