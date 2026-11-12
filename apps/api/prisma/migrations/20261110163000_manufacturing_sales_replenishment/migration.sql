-- AlterTable
ALTER TABLE "ManufacturingOrder" ADD COLUMN     "salesReviewNote" TEXT,
ADD COLUMN     "salesStatus" TEXT NOT NULL DEFAULT 'confirmed';

-- CreateTable
CREATE TABLE "ManufacturingWarehousePurchase" (
    "purchaseId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManufacturingWarehousePurchase_pkey" PRIMARY KEY ("purchaseId")
);

-- CreateIndex
CREATE INDEX "ManufacturingWarehousePurchase_tenantId_warehouseId_created_idx" ON "ManufacturingWarehousePurchase"("tenantId", "warehouseId", "createdAt");

