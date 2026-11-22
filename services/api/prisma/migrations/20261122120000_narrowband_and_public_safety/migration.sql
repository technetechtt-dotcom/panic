ALTER TABLE "Device" ADD COLUMN "narrowbandKeySeal" TEXT;
ALTER TABLE "Device" ADD COLUMN "iridiumImei" TEXT;

CREATE UNIQUE INDEX "Device_iridiumImei_key" ON "Device"("iridiumImei");

CREATE TABLE "PublicSafetyHandoff" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "service" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT,
    "detail" TEXT NOT NULL,
    "dial" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicSafetyHandoff_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PublicSafetyHandoff_incidentId_service_createdAt_idx" ON "PublicSafetyHandoff"("incidentId", "service", "createdAt");

ALTER TABLE "PublicSafetyHandoff" ADD CONSTRAINT "PublicSafetyHandoff_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
