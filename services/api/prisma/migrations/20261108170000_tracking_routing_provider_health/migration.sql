-- AlterTable
ALTER TABLE "ProtectionSession" ADD COLUMN     "routePolyline" JSONB,
ADD COLUMN     "routeStatus" TEXT NOT NULL DEFAULT 'UNAVAILABLE';

-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN     "dedupeKey" TEXT;

-- CreateTable
CREATE TABLE "TrackingSample" (
    "sampleId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" UUID NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "speedMps" DOUBLE PRECISION,
    "bearing" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingSample_pkey" PRIMARY KEY ("sampleId")
);

-- CreateTable
CREATE TABLE "IntegrationHealth" (
    "kind" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "detail" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationHealth_pkey" PRIMARY KEY ("kind")
);

-- CreateIndex
CREATE INDEX "TrackingSample_kind_targetId_recordedAt_idx" ON "TrackingSample"("kind", "targetId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_dedupeKey_key" ON "OutboxEvent"("dedupeKey");

-- Human acknowledgement is incident/contact scoped, independent of channel outcomes.
INSERT INTO "GuardianAcknowledgement" ("incidentId", "trustedContactId", "acknowledgedAt")
SELECT "incidentId", "trustedContactId", MIN("acknowledgedAt")
FROM "NotificationDelivery"
WHERE "trustedContactId" IS NOT NULL AND "acknowledgedAt" IS NOT NULL
GROUP BY "incidentId", "trustedContactId"
ON CONFLICT ("incidentId", "trustedContactId") DO NOTHING;

-- Old acknowledgement writes destroyed delivery status; timestamps are the only surviving proof.
-- Do not claim a delivery where no delivery receipt exists.
UPDATE "NotificationDelivery"
SET "status" = CASE WHEN "failedAt" IS NOT NULL THEN 'FAILED'
                    WHEN "deliveredAt" IS NOT NULL THEN 'DELIVERED'
                    WHEN "sentAt" IS NOT NULL THEN 'SENT' ELSE 'SKIPPED' END,
    "detail" = "detail" || ' Legacy acknowledgement was separated; channel outcome restored from surviving timestamps only.'
WHERE "status" = 'ACKNOWLEDGED';
