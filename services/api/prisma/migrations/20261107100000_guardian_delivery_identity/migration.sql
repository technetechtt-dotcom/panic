ALTER TABLE "NotificationDelivery" ADD COLUMN "trustedContactId" UUID;
ALTER TABLE "IncidentRoom" ADD COLUMN "trustedContactId" UUID;

CREATE INDEX "NotificationDelivery_trustedContactId_idx" ON "NotificationDelivery"("trustedContactId");
CREATE INDEX "IncidentRoom_trustedContactId_idx" ON "IncidentRoom"("trustedContactId");
