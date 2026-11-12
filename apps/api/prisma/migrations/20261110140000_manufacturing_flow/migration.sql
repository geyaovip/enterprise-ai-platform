-- CreateTable
CREATE TABLE "ManufacturingItem" (
    "tenantId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "ManufacturingItem_pkey" PRIMARY KEY ("tenantId","materialId")
);

-- CreateTable
CREATE TABLE "ManufacturingOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "completedQty" INTEGER NOT NULL DEFAULT 0,
    "shippedQty" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "bomId" TEXT NOT NULL,
    "bomRevision" INTEGER NOT NULL,
    "bomVersions" JSONB NOT NULL,
    "dueDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManufacturingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingRequirement" (
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "issued" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "consumed" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "wipValue" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "ManufacturingRequirement_pkey" PRIMARY KEY ("orderId","productId")
);

-- CreateTable
CREATE TABLE "ManufacturingPurchase" (
    "purchaseId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "ManufacturingPurchase_pkey" PRIMARY KEY ("purchaseId")
);

-- CreateTable
CREATE TABLE "ManufacturingReceipt" (
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManufacturingReceipt_pkey" PRIMARY KEY ("tenantId","membershipId","requestKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManufacturingItem_tenantId_productId_key" ON "ManufacturingItem"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "ManufacturingOrder_tenantId_createdAt_idx" ON "ManufacturingOrder"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ManufacturingOrder_tenantId_number_key" ON "ManufacturingOrder"("tenantId", "number");

-- CreateIndex
CREATE INDEX "ManufacturingPurchase_orderId_idx" ON "ManufacturingPurchase"("orderId");

-- AddForeignKey
ALTER TABLE "ManufacturingRequirement" ADD CONSTRAINT "ManufacturingRequirement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ManufacturingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingPurchase" ADD CONSTRAINT "ManufacturingPurchase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ManufacturingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

