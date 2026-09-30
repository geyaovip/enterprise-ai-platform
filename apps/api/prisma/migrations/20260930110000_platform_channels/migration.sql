CREATE TABLE "ChannelConnection" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "secretCiphertext" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'configured',
  "lastError" TEXT,
  "connectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChannelConnection_tenantId_provider_key" ON "ChannelConnection"("tenantId", "provider");
CREATE UNIQUE INDEX "ChannelConnection_provider_appId_key" ON "ChannelConnection"("provider", "appId");
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ChannelConnectAttempt" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'starting',
  "qrUrl" TEXT,
  "expiresAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelConnectAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChannelConnectAttempt_tenantId_membershipId_createdAt_idx" ON "ChannelConnectAttempt"("tenantId", "membershipId", "createdAt");

CREATE TABLE "ChannelIdentity" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "externalUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChannelIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChannelIdentity_connectionId_membershipId_key" ON "ChannelIdentity"("connectionId", "membershipId");
CREATE UNIQUE INDEX "ChannelIdentity_connectionId_externalUserId_key" ON "ChannelIdentity"("connectionId", "externalUserId");
CREATE INDEX "ChannelIdentity_tenantId_membershipId_idx" ON "ChannelIdentity"("tenantId", "membershipId");
ALTER TABLE "ChannelIdentity" ADD CONSTRAINT "ChannelIdentity_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ChannelPairCode" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChannelPairCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChannelPairCode_codeHash_key" ON "ChannelPairCode"("codeHash");
CREATE INDEX "ChannelPairCode_tenantId_membershipId_createdAt_idx" ON "ChannelPairCode"("tenantId", "membershipId", "createdAt");

CREATE TABLE "ChannelChatSession" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "externalChatId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChannelChatSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChannelChatSession_connectionId_externalChatId_membershipId_key" ON "ChannelChatSession"("connectionId", "externalChatId", "membershipId");

CREATE TABLE "ChannelInbound" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "chatType" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "replyText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelInbound_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChannelInbound_connectionId_messageId_key" ON "ChannelInbound"("connectionId", "messageId");
CREATE INDEX "ChannelInbound_status_nextAttemptAt_idx" ON "ChannelInbound"("status", "nextAttemptAt");

CREATE TABLE "ChannelDelivery" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "providerMessageId" TEXT,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "ChannelDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChannelDelivery_connectionId_membershipId_eventKey_key" ON "ChannelDelivery"("connectionId", "membershipId", "eventKey");
CREATE INDEX "ChannelDelivery_status_nextAttemptAt_idx" ON "ChannelDelivery"("status", "nextAttemptAt");
ALTER TABLE "ChannelDelivery" ADD CONSTRAINT "ChannelDelivery_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
