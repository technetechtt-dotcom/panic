ALTER TABLE "Device" ADD COLUMN "publicKey" TEXT;

CREATE TABLE "IncidentEscalation" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "triggerId" UUID NOT NULL,
    "triggerType" "TriggerType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IncidentEscalation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IncidentEscalation_triggerId_key" ON "IncidentEscalation"("triggerId");
CREATE INDEX "IncidentEscalation_incidentId_idx" ON "IncidentEscalation"("incidentId");

ALTER TABLE "IncidentEscalation" ADD CONSTRAINT "IncidentEscalation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SafetyPin" (
    "userId" UUID NOT NULL,
    "cancelPinHash" TEXT NOT NULL,
    "duressPinHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SafetyPin_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "SafetyPin" ADD CONSTRAINT "SafetyPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TrustedContact" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "canViewLocation" BOOLEAN NOT NULL DEFAULT false,
    "canViewEvidence" BOOLEAN NOT NULL DEFAULT false,
    "canCancelIncident" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrustedContact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrustedContact_userId_idx" ON "TrustedContact"("userId");
ALTER TABLE "TrustedContact" ADD CONSTRAINT "TrustedContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProtectionSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "destinationLabel" TEXT NOT NULL,
    "expectedArrivalAt" TIMESTAMP(3) NOT NULL,
    "checkInIntervalSeconds" INTEGER NOT NULL,
    "lastCheckInAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProtectionSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProtectionSession_userId_status_idx" ON "ProtectionSession"("userId", "status");
ALTER TABLE "ProtectionSession" ADD CONSTRAINT "ProtectionSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RiskSignal" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RiskSignal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RiskSignal_sessionId_type_key" ON "RiskSignal"("sessionId", "type");
CREATE INDEX "RiskSignal_userId_idx" ON "RiskSignal"("userId");

CREATE TABLE "EvidenceChunk" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "clientChunkId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "payload" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EvidenceChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EvidenceChunk_incidentId_clientChunkId_key" ON "EvidenceChunk"("incidentId", "clientChunkId");
CREATE INDEX "EvidenceChunk_incidentId_sequence_idx" ON "EvidenceChunk"("incidentId", "sequence");
ALTER TABLE "EvidenceChunk" ADD CONSTRAINT "EvidenceChunk_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
