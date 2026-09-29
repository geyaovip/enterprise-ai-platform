-- CreateTable
CREATE TABLE "ErpCustomer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "industry" TEXT,
    "ownerMembershipId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpOpportunity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'discovery',
    "estimatedAmount" DECIMAL(18,2) NOT NULL,
    "ownerMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpProduct" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT '件',
    "salePrice" DECIMAL(18,2) NOT NULL,
    "purchasePrice" DECIMAL(18,2) NOT NULL,
    "reorderPoint" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpSupplier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpPurchaseOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "total" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpPurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpPurchaseLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "lineTotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "ErpPurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpSalesContract" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "ownerMembershipId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "total" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpSalesContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpSalesLine" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "shippedQty" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "lineTotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "ErpSalesLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpInventoryBalance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpInventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpStockDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "note" TEXT,
    "actorMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpStockDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpStockMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "actorMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpPayable" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpPayable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpReceivable" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpReceivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "receivableId" TEXT,
    "payableId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "reference" TEXT NOT NULL,
    "actorMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErpCustomer_tenantId_ownerMembershipId_idx" ON "ErpCustomer"("tenantId", "ownerMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpCustomer_tenantId_code_key" ON "ErpCustomer"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ErpOpportunity_tenantId_ownerMembershipId_stage_idx" ON "ErpOpportunity"("tenantId", "ownerMembershipId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "ErpProduct_tenantId_sku_key" ON "ErpProduct"("tenantId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ErpSupplier_tenantId_code_key" ON "ErpSupplier"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ErpPurchaseOrder_tenantId_status_idx" ON "ErpPurchaseOrder"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ErpPurchaseOrder_tenantId_number_key" ON "ErpPurchaseOrder"("tenantId", "number");

-- CreateIndex
CREATE INDEX "ErpSalesContract_tenantId_ownerMembershipId_status_idx" ON "ErpSalesContract"("tenantId", "ownerMembershipId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ErpSalesContract_tenantId_number_key" ON "ErpSalesContract"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ErpInventoryBalance_productId_key" ON "ErpInventoryBalance"("productId");

-- CreateIndex
CREATE INDEX "ErpInventoryBalance_tenantId_productId_idx" ON "ErpInventoryBalance"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "ErpStockDocument_tenantId_kind_sourceId_createdAt_idx" ON "ErpStockDocument"("tenantId", "kind", "sourceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ErpStockDocument_tenantId_number_key" ON "ErpStockDocument"("tenantId", "number");

-- CreateIndex
CREATE INDEX "ErpStockMovement_tenantId_productId_createdAt_idx" ON "ErpStockMovement"("tenantId", "productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ErpStockMovement_tenantId_documentId_productId_key" ON "ErpStockMovement"("tenantId", "documentId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpPayable_orderId_key" ON "ErpPayable"("orderId");

-- CreateIndex
CREATE INDEX "ErpPayable_tenantId_status_idx" ON "ErpPayable"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ErpReceivable_contractId_key" ON "ErpReceivable"("contractId");

-- CreateIndex
CREATE INDEX "ErpReceivable_tenantId_status_idx" ON "ErpReceivable"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ErpPayment_tenantId_receivableId_reference_key" ON "ErpPayment"("tenantId", "receivableId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "ErpPayment_tenantId_payableId_reference_key" ON "ErpPayment"("tenantId", "payableId", "reference");

-- AddForeignKey
ALTER TABLE "ErpOpportunity" ADD CONSTRAINT "ErpOpportunity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "ErpCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpPurchaseOrder" ADD CONSTRAINT "ErpPurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ErpSupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpPurchaseLine" ADD CONSTRAINT "ErpPurchaseLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ErpPurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpPurchaseLine" ADD CONSTRAINT "ErpPurchaseLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ErpProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSalesContract" ADD CONSTRAINT "ErpSalesContract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "ErpCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSalesContract" ADD CONSTRAINT "ErpSalesContract_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "ErpOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSalesLine" ADD CONSTRAINT "ErpSalesLine_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ErpSalesContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSalesLine" ADD CONSTRAINT "ErpSalesLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ErpProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpInventoryBalance" ADD CONSTRAINT "ErpInventoryBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ErpProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpStockMovement" ADD CONSTRAINT "ErpStockMovement_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ErpStockDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpPayable" ADD CONSTRAINT "ErpPayable_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ErpPurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpReceivable" ADD CONSTRAINT "ErpReceivable_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ErpSalesContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpPayment" ADD CONSTRAINT "ErpPayment_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "ErpReceivable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpPayment" ADD CONSTRAINT "ErpPayment_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "ErpPayable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
