CREATE UNIQUE INDEX "ErpPayment_tenantId_advanceId_reference_key" ON "ErpPayment"("tenantId", "advanceId", "reference");
-- Historical rows used product base units before trade-unit conversion was introduced.
UPDATE "ErpPurchaseLine" l SET "baseUnit"=p."unit", "unit"=p."unit" FROM "ErpProduct" p WHERE l."productId"=p."id" AND l."baseUnit"='件' AND l."unitFactor"=1 AND l."basePrice" IS NULL;
UPDATE "ErpSalesLine" l SET "baseUnit"=p."unit", "unit"=p."unit" FROM "ErpProduct" p WHERE l."productId"=p."id" AND l."baseUnit"='件' AND l."unitFactor"=1 AND l."basePrice" IS NULL;
