-- AlterTable
ALTER TABLE "ErpStockMovement" ADD COLUMN     "trackingCode" TEXT,
ADD COLUMN     "trackingKind" TEXT;

-- CreateTable
CREATE TABLE "ErpStockHold" (
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "ErpStockHold_pkey" PRIMARY KEY ("tenantId","warehouseId","productId","orderId")
);

-- CreateTable
CREATE TABLE "ErpTrackedStock" (
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "ErpTrackedStock_pkey" PRIMARY KEY ("tenantId","warehouseId","productId","code")
);

-- CreateTable
CREATE TABLE "ManufacturingPlan" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ManufacturingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingJob" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManufacturingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingReport" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "good" INTEGER NOT NULL,
    "defective" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ManufacturingReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingMaterialUse" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT,
    "kind" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "ManufacturingMaterialUse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingMemberGrant" (
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "ManufacturingMemberGrant_pkey" PRIMARY KEY ("tenantId","membershipId")
);

-- CreateIndex
CREATE INDEX "ErpStockHold_tenantId_orderId_idx" ON "ErpStockHold"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "ErpTrackedStock_tenantId_code_idx" ON "ErpTrackedStock"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ManufacturingPlan_orderId_key" ON "ManufacturingPlan"("orderId");

-- CreateIndex
CREATE INDEX "ManufacturingJob_planId_idx" ON "ManufacturingJob"("planId");

-- CreateIndex
CREATE INDEX "ManufacturingReport_jobId_createdAt_idx" ON "ManufacturingReport"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "ManufacturingMaterialUse_orderId_productId_idx" ON "ManufacturingMaterialUse"("orderId", "productId");

-- CreateIndex
CREATE INDEX "ManufacturingMaterialUse_documentId_idx" ON "ManufacturingMaterialUse"("documentId");

-- CreateIndex
CREATE INDEX "ErpStockMovement_tenantId_trackingCode_idx" ON "ErpStockMovement"("tenantId", "trackingCode");

-- AddForeignKey
ALTER TABLE "ManufacturingPlan" ADD CONSTRAINT "ManufacturingPlan_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ManufacturingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingJob" ADD CONSTRAINT "ManufacturingJob_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ManufacturingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingReport" ADD CONSTRAINT "ManufacturingReport_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ManufacturingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingMaterialUse" ADD CONSTRAINT "ManufacturingMaterialUse_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ManufacturingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

