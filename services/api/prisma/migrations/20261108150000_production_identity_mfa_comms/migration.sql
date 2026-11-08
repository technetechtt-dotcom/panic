ALTER TABLE "User"
ADD COLUMN "guardianNotificationMethods" TEXT NOT NULL DEFAULT 'PUSH,SMS,EMAIL';

ALTER TABLE "OperatorMfa"
ADD COLUMN "pendingSecret" TEXT,
ADD COLUMN "pendingCreatedAt" TIMESTAMP(3);

CREATE TABLE "IncidentCommunication" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "actorId" UUID,
    "channel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "externalReference" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IncidentCommunication_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IncidentCommunication_incidentId_occurredAt_idx"
ON "IncidentCommunication"("incidentId", "occurredAt");

CREATE INDEX "IncidentCommunication_actorId_occurredAt_idx"
ON "IncidentCommunication"("actorId", "occurredAt");

ALTER TABLE "IncidentCommunication"
ADD CONSTRAINT "IncidentCommunication_incidentId_fkey"
FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
