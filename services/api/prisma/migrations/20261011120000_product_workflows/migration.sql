ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "RecoveryToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecoveryToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RecoveryToken_tokenHash_key" ON "RecoveryToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "RecoveryToken_userId_purpose_idx" ON "RecoveryToken"("userId", "purpose");

ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "nickname" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "pushTokenUpdatedAt" TIMESTAMP(3);

ALTER TABLE "TrustedContact" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);
ALTER TABLE "TrustedContact" ADD COLUMN IF NOT EXISTS "lastNotifiedAt" TIMESTAMP(3);
ALTER TABLE "TrustedContact" ADD COLUMN IF NOT EXISTS "lastAcknowledgedAt" TIMESTAMP(3);
ALTER TABLE "TrustedContact" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT;
ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "attemptNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "queuedAt" TIMESTAMP(3);
ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3);
ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "failedAt" TIMESTAMP(3);
ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "failureCode" TEXT;
ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "openedAt" TIMESTAMP(3);
ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "acknowledgedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "EvidenceAccessLog" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceAccessLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EvidenceAccessLog_incidentId_createdAt_idx" ON "EvidenceAccessLog"("incidentId", "createdAt");

ALTER TABLE "ResponderAssignment" ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3);
ALTER TABLE "ResponderAssignment" ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3);
ALTER TABLE "ResponderAssignment" ADD COLUMN IF NOT EXISTS "enRouteAt" TIMESTAMP(3);
ALTER TABLE "ResponderAssignment" ADD COLUMN IF NOT EXISTS "arrivedAt" TIMESTAMP(3);
ALTER TABLE "ResponderAssignment" ADD COLUMN IF NOT EXISTS "locatedAt" TIMESTAMP(3);
ALTER TABLE "ResponderAssignment" ADD COLUMN IF NOT EXISTS "declinedAt" TIMESTAMP(3);
ALTER TABLE "ResponderAssignment" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "ResponderAssignment" ADD COLUMN IF NOT EXISTS "assignedBy" TEXT;

CREATE TABLE IF NOT EXISTS "ResponderProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "team" TEXT,
    "region" TEXT,
    "capabilities" TEXT,
    "vehicle" TEXT,
    "phone" TEXT,
    "availability" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResponderProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ResponderProfile_userId_key" ON "ResponderProfile"("userId");
