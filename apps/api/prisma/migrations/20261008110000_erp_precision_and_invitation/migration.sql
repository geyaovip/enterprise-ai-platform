-- AlterTable
ALTER TABLE "ErpPurchaseLine" ADD COLUMN     "baseUnit" TEXT NOT NULL DEFAULT '件',
ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(24,6);

-- AlterTable
ALTER TABLE "ErpSalesLine" ADD COLUMN     "baseUnit" TEXT NOT NULL DEFAULT '件',
ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(24,6);

-- AlterTable
ALTER TABLE "ErpStockMovement" ADD COLUMN     "grossAmount" DECIMAL(18,2),
ALTER COLUMN "unitCost" SET DATA TYPE DECIMAL(30,6);

-- CreateTable
CREATE TABLE "MemberInvitation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'invite',
    "tokenHash" TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberInvitation_tokenHash_key" ON "MemberInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "MemberInvitation_tenantId_email_createdAt_idx" ON "MemberInvitation"("tenantId", "email", "createdAt");
