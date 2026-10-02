ALTER TABLE "Device" ADD COLUMN "emergencyTokenHash" TEXT;
CREATE INDEX "Device_emergencyTokenHash_idx" ON "Device"("emergencyTokenHash");

CREATE UNIQUE INDEX "Incident_one_active_user" ON "Incident" ("userId")
WHERE "state" NOT IN ('RESOLVED', 'ARCHIVED');
