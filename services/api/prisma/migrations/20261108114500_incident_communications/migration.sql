CREATE TABLE "IncidentCommunication" (
  "id" UUID NOT NULL,
  "incidentId" UUID NOT NULL,
  "actorId" UUID,
  "channel" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "externalReference" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IncidentCommunication_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IncidentCommunication_incidentId_occurredAt_idx" ON "IncidentCommunication"("incidentId","occurredAt");
ALTER TABLE "IncidentCommunication" ADD CONSTRAINT "IncidentCommunication_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncidentCommunication" ADD CONSTRAINT "IncidentCommunication_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
