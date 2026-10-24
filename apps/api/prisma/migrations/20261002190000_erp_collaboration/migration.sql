-- CreateTable
CREATE TABLE "ErpTask" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdByMembershipId" TEXT NOT NULL,
    "assigneeMembershipId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpNotification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recipientMembershipId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpAnnouncement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpAnnouncementRead" (
    "tenantId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpAnnouncementRead_pkey" PRIMARY KEY ("announcementId","membershipId")
);

-- CreateIndex
CREATE INDEX "ErpTask_tenantId_assigneeMembershipId_status_dueAt_idx" ON "ErpTask"("tenantId", "assigneeMembershipId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "ErpTask_tenantId_createdByMembershipId_idx" ON "ErpTask"("tenantId", "createdByMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpTask_id_tenantId_key" ON "ErpTask"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpTask_tenantId_createdByMembershipId_requestKey_key" ON "ErpTask"("tenantId", "createdByMembershipId", "requestKey");

-- CreateIndex
CREATE INDEX "ErpNotification_tenantId_recipientMembershipId_createdAt_idx" ON "ErpNotification"("tenantId", "recipientMembershipId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ErpNotification_tenantId_recipientMembershipId_dedupeKey_key" ON "ErpNotification"("tenantId", "recipientMembershipId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ErpAnnouncement_tenantId_active_createdAt_idx" ON "ErpAnnouncement"("tenantId", "active", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ErpAnnouncement_id_tenantId_key" ON "ErpAnnouncement"("id", "tenantId");

-- CreateIndex
CREATE INDEX "ErpAnnouncementRead_tenantId_membershipId_idx" ON "ErpAnnouncementRead"("tenantId", "membershipId");

-- AddForeignKey
ALTER TABLE "ErpTask" ADD CONSTRAINT "ErpTask_createdByMembershipId_tenantId_fkey" FOREIGN KEY ("createdByMembershipId", "tenantId") REFERENCES "Membership"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpTask" ADD CONSTRAINT "ErpTask_assigneeMembershipId_tenantId_fkey" FOREIGN KEY ("assigneeMembershipId", "tenantId") REFERENCES "Membership"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpNotification" ADD CONSTRAINT "ErpNotification_recipientMembershipId_tenantId_fkey" FOREIGN KEY ("recipientMembershipId", "tenantId") REFERENCES "Membership"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpAnnouncement" ADD CONSTRAINT "ErpAnnouncement_createdByMembershipId_tenantId_fkey" FOREIGN KEY ("createdByMembershipId", "tenantId") REFERENCES "Membership"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpAnnouncementRead" ADD CONSTRAINT "ErpAnnouncementRead_announcementId_tenantId_fkey" FOREIGN KEY ("announcementId", "tenantId") REFERENCES "ErpAnnouncement"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpAnnouncementRead" ADD CONSTRAINT "ErpAnnouncementRead_membershipId_tenantId_fkey" FOREIGN KEY ("membershipId", "tenantId") REFERENCES "Membership"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

