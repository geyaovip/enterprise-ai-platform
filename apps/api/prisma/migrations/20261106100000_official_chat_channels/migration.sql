ALTER TABLE "ChannelConnection" ADD COLUMN "cursor" TEXT;
ALTER TABLE "ChannelConnectAttempt" ADD COLUMN "stateCiphertext" TEXT, ADD COLUMN "pollAfter" TIMESTAMP(3);
ALTER TABLE "ChannelIdentity" ADD COLUMN "appId" TEXT NOT NULL DEFAULT 'erp';
ALTER TABLE "ChannelChatSession" ADD COLUMN "appId" TEXT NOT NULL DEFAULT 'erp';
DROP INDEX "ChannelChatSession_connectionId_externalChatId_membershipId_key";
CREATE UNIQUE INDEX "ChannelChatSession_connectionId_externalChatId_membershipId_appId_key" ON "ChannelChatSession"("connectionId", "externalChatId", "membershipId", "appId");
ALTER TABLE "ChannelInbound" ADD COLUMN "contextCiphertext" TEXT;
ALTER TABLE "ChannelInbound" ADD COLUMN "replyMembershipId" TEXT, ADD COLUMN "replyAppId" TEXT, ADD COLUMN "aiStartedAt" TIMESTAMP(3);
