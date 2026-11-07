ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
CREATE TABLE "AuthEmailChallenge" (
  "id" TEXT NOT NULL PRIMARY KEY, "email" TEXT NOT NULL, "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0, "sentAt" TIMESTAMP(3), "usedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AuthEmailChallenge_email_createdAt_idx" ON "AuthEmailChallenge"("email", "createdAt");
CREATE INDEX "AuthEmailChallenge_expiresAt_idx" ON "AuthEmailChallenge"("expiresAt");
CREATE TABLE "AuthEmailRate" ("key" TEXT NOT NULL PRIMARY KEY, "count" INTEGER NOT NULL DEFAULT 1, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "AuthEmailRate_expiresAt_idx" ON "AuthEmailRate"("expiresAt");
