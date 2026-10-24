-- DropForeignKey
ALTER TABLE "ErpPayable" DROP CONSTRAINT "ErpPayable_orderId_fkey";

-- DropForeignKey
ALTER TABLE "ErpReceivable" DROP CONSTRAINT "ErpReceivable_contractId_fkey";

-- DropIndex
DROP INDEX "ErpStockMovement_tenantId_documentId_productId_key";

-- AlterTable
ALTER TABLE "ErpCustomer" ADD COLUMN     "address" TEXT,
ADD COLUMN     "creditLimit" DECIMAL(18,2),
ADD COLUMN     "paymentDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxNumber" TEXT;

-- AlterTable
ALTER TABLE "ErpProduct" ALTER COLUMN "reorderPoint" SET DEFAULT 0,
ALTER COLUMN "reorderPoint" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ErpSupplier" ADD COLUMN     "address" TEXT,
ADD COLUMN     "paymentDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxNumber" TEXT;

-- AlterTable
ALTER TABLE "ErpPurchaseOrder" ADD COLUMN     "closeReason" TEXT,
ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryAt" TIMESTAMP(3),
ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "paymentTerms" TEXT;

-- AlterTable
ALTER TABLE "ErpPurchaseLine" ADD COLUMN     "basePrice" DECIMAL(18,2),
ADD COLUMN     "discountPercent" DECIMAL(6,3) NOT NULL DEFAULT 0,
ADD COLUMN     "taxIncluded" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "taxRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
ADD COLUMN     "unit" TEXT NOT NULL DEFAULT '件',
ADD COLUMN     "unitFactor" DOUBLE PRECISION NOT NULL DEFAULT 1,
ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "receivedQty" SET DEFAULT 0,
ALTER COLUMN "receivedQty" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ErpSalesContract" ADD COLUMN     "closeReason" TEXT,
ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryAt" TIMESTAMP(3),
ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "paymentTerms" TEXT;

-- AlterTable
ALTER TABLE "ErpSalesLine" ADD COLUMN     "basePrice" DECIMAL(18,2),
ADD COLUMN     "discountPercent" DECIMAL(6,3) NOT NULL DEFAULT 0,
ADD COLUMN     "taxIncluded" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "taxRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
ADD COLUMN     "unit" TEXT NOT NULL DEFAULT '件',
ADD COLUMN     "unitFactor" DOUBLE PRECISION NOT NULL DEFAULT 1,
ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "shippedQty" SET DEFAULT 0,
ALTER COLUMN "shippedQty" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ErpInventoryBalance" ADD COLUMN     "costEstimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inventoryValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "openingAt" TIMESTAMP(3),
ALTER COLUMN "quantity" SET DEFAULT 0,
ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ErpStockMovement" ADD COLUMN     "costAmount" DECIMAL(18,2),
ADD COLUMN     "costEstimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tradeAmount" DECIMAL(18,2),
ADD COLUMN     "unitCost" DECIMAL(18,6),
ADD COLUMN     "warehouseId" TEXT,
ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ErpPayable" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "openingReference" TEXT,
ADD COLUMN     "supplierId" TEXT,
ALTER COLUMN "orderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ErpReceivable" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "openingReference" TEXT,
ALTER COLUMN "contractId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ErpPayment" ADD COLUMN     "advanceId" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'payment',
ADD COLUMN     "note" TEXT,
ADD COLUMN     "reversalOfId" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ErpWarehouse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "ownerMembershipId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpWarehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpWarehouseStock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ErpWarehouseStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpTradeReturn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "reviewedByMembershipId" TEXT,
    "reviewReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ErpTradeReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpOpeningBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "openingAt" TIMESTAMP(3) NOT NULL,
    "lines" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpOpeningBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpAdvance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpQuotation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "ownerMembershipId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "terms" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "contractId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpCustomerPrice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "ErpCustomerPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpBusinessSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyAddress" TEXT,
    "companyPhone" TEXT,
    "taxNumber" TEXT,
    "approvalConfig" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ErpBusinessSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpAccountEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reference" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpAccountEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErpWarehouse_tenantId_code_key" ON "ErpWarehouse"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ErpWarehouseStock_tenantId_productId_idx" ON "ErpWarehouseStock"("tenantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpWarehouseStock_warehouseId_productId_key" ON "ErpWarehouseStock"("warehouseId", "productId");

-- CreateIndex
CREATE INDEX "ErpTradeReturn_tenantId_kind_sourceId_status_idx" ON "ErpTradeReturn"("tenantId", "kind", "sourceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ErpTradeReturn_tenantId_number_key" ON "ErpTradeReturn"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ErpTradeReturn_tenantId_requestKey_key" ON "ErpTradeReturn"("tenantId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ErpOpeningBatch_tenantId_requestKey_key" ON "ErpOpeningBatch"("tenantId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ErpOpeningBatch_tenantId_reference_key" ON "ErpOpeningBatch"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "ErpAdvance_tenantId_requestKey_key" ON "ErpAdvance"("tenantId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ErpAdvance_tenantId_kind_reference_key" ON "ErpAdvance"("tenantId", "kind", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "ErpQuotation_contractId_key" ON "ErpQuotation"("contractId");

-- CreateIndex
CREATE INDEX "ErpQuotation_tenantId_ownerMembershipId_idx" ON "ErpQuotation"("tenantId", "ownerMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpQuotation_tenantId_number_key" ON "ErpQuotation"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ErpCustomerPrice_tenantId_customerId_productId_key" ON "ErpCustomerPrice"("tenantId", "customerId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpBusinessSettings_tenantId_key" ON "ErpBusinessSettings"("tenantId");

-- CreateIndex
CREATE INDEX "ErpAccountEntry_tenantId_kind_partyId_occurredAt_idx" ON "ErpAccountEntry"("tenantId", "kind", "partyId", "occurredAt");

-- CreateIndex
CREATE INDEX "ErpStockMovement_tenantId_documentId_productId_idx" ON "ErpStockMovement"("tenantId", "documentId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpPayment_reversalOfId_key" ON "ErpPayment"("reversalOfId");

-- AddForeignKey
ALTER TABLE "ErpPayable" ADD CONSTRAINT "ErpPayable_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ErpPurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpReceivable" ADD CONSTRAINT "ErpReceivable_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ErpSalesContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve existing single-warehouse stock and explicitly label its reference-cost basis.
INSERT INTO "ErpWarehouse" ("id","tenantId","code","name","active","version","createdAt")
SELECT md5(t.id || ':default-warehouse')::uuid::text,t.id,'DEFAULT','默认仓库',true,1,now() FROM "Tenant" t;
INSERT INTO "ErpWarehouseStock" ("id","tenantId","warehouseId","productId","quantity","version")
SELECT md5(b.id || ':warehouse-stock')::uuid::text,b."tenantId",w.id,b."productId",b.quantity,1 FROM "ErpInventoryBalance" b JOIN "ErpWarehouse" w ON w."tenantId"=b."tenantId" AND w.code='DEFAULT';
UPDATE "ErpInventoryBalance" b SET "inventoryValue"=round(b.quantity::numeric*p."purchasePrice",2),"costEstimated"=(b.quantity>0) FROM "ErpProduct" p WHERE p.id=b."productId";
UPDATE "ErpStockMovement" m SET "warehouseId"=w.id FROM "ErpWarehouse" w WHERE w."tenantId"=m."tenantId" AND w.code='DEFAULT';
UPDATE "ErpReceivable" a SET "customerId"=c."customerId" FROM "ErpSalesContract" c WHERE c.id=a."contractId";
UPDATE "ErpPayable" a SET "supplierId"=o."supplierId" FROM "ErpPurchaseOrder" o WHERE o.id=a."orderId";
INSERT INTO "ErpAccountEntry" (id,"tenantId",kind,"accountId","partyId",amount,reference,"sourceType","sourceId",estimated,"occurredAt")
SELECT md5(id||':opening-ledger')::uuid::text,"tenantId",'receivable',id,"customerId",amount,'历史应收结转','legacy',id,true,"createdAt" FROM "ErpReceivable" WHERE "customerId" IS NOT NULL;
INSERT INTO "ErpAccountEntry" (id,"tenantId",kind,"accountId","partyId",amount,reference,"sourceType","sourceId",estimated,"occurredAt")
SELECT md5(id||':opening-ledger')::uuid::text,"tenantId",'payable',id,"supplierId",amount,'历史应付结转','legacy',id,true,"createdAt" FROM "ErpPayable" WHERE "supplierId" IS NOT NULL;
