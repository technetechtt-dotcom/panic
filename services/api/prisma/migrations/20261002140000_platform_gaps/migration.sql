ALTER TABLE "Device" ADD COLUMN "fcmToken" TEXT;

ALTER TABLE "ProtectionSession" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'WALK';
ALTER TABLE "ProtectionSession" ADD COLUMN "originLatitude" DOUBLE PRECISION;
ALTER TABLE "ProtectionSession" ADD COLUMN "originLongitude" DOUBLE PRECISION;
ALTER TABLE "ProtectionSession" ADD COLUMN "destinationLatitude" DOUBLE PRECISION;
ALTER TABLE "ProtectionSession" ADD COLUMN "destinationLongitude" DOUBLE PRECISION;
ALTER TABLE "ProtectionSession" ADD COLUMN "corridorMeters" INTEGER NOT NULL DEFAULT 400;

ALTER TABLE "EvidenceChunk" ADD COLUMN "storageKey" TEXT;

CREATE TABLE "EmergencyProfile" (
    "userId" UUID NOT NULL,
    "bloodType" TEXT,
    "allergies" TEXT,
    "medications" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmergencyProfile_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "OperatorMfa" (
    "userId" UUID NOT NULL,
    "secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OperatorMfa_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "NotificationDelivery" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IncidentRoom" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "canViewLocation" BOOLEAN NOT NULL,
    "canViewEvidence" BOOLEAN NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IncidentRoom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResponderAssignment" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "responderId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResponderAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IncidentRoom_tokenHash_key" ON "IncidentRoom"("tokenHash");
CREATE INDEX "NotificationDelivery_incidentId_createdAt_idx" ON "NotificationDelivery"("incidentId", "createdAt");
CREATE UNIQUE INDEX "ResponderAssignment_incidentId_responderId_key" ON "ResponderAssignment"("incidentId", "responderId");
CREATE INDEX "ResponderAssignment_responderId_idx" ON "ResponderAssignment"("responderId");

ALTER TABLE "EmergencyProfile" ADD CONSTRAINT "EmergencyProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperatorMfa" ADD CONSTRAINT "OperatorMfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncidentRoom" ADD CONSTRAINT "IncidentRoom_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResponderAssignment" ADD CONSTRAINT "ResponderAssignment_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResponderAssignment" ADD CONSTRAINT "ResponderAssignment_responderId_fkey" FOREIGN KEY ("responderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
