ALTER TABLE "User" ADD COLUMN "account" TEXT;
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
CREATE UNIQUE INDEX "User_account_key" ON "User"("account");
ALTER TABLE "Tenant" ADD COLUMN "selfServiceOwnerId" TEXT;
CREATE UNIQUE INDEX "Tenant_selfServiceOwnerId_key" ON "Tenant"("selfServiceOwnerId");
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_selfServiceOwnerId_fkey" FOREIGN KEY ("selfServiceOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
