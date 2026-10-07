ALTER TABLE "Device" ADD COLUMN "revokedAt" TIMESTAMP(3);

ALTER TABLE "Incident" ADD COLUMN "claimedBy" TEXT;
ALTER TABLE "Incident" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "Incident" ADD COLUMN "escalatedToSupervisorAt" TIMESTAMP(3);

ALTER TABLE "TrustedContact" ADD COLUMN "relationship" TEXT NOT NULL DEFAULT 'FRIEND';
ALTER TABLE "TrustedContact" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "TrustedContact" ADD COLUMN "notificationMethods" TEXT NOT NULL DEFAULT 'PUSH,SMS';
ALTER TABLE "TrustedContact" ADD COLUMN "guardianUserId" UUID;
ALTER TABLE "TrustedContact" ADD COLUMN "invitationStatus" TEXT NOT NULL DEFAULT 'ACCEPTED';
ALTER TABLE "TrustedContact" ADD COLUMN "invitationToken" TEXT;

CREATE UNIQUE INDEX "TrustedContact_invitationToken_key" ON "TrustedContact"("invitationToken");

ALTER TABLE "IncidentRoom" ADD COLUMN "guardianName" TEXT;
ALTER TABLE "IncidentRoom" ADD COLUMN "acknowledgedAt" TIMESTAMP(3);
