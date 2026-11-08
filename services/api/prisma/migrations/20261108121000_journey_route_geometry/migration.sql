ALTER TABLE "ProtectionSession" ADD COLUMN "routeGeometry" JSONB;
ALTER TABLE "ProtectionSession" ADD COLUMN "routeSource" TEXT NOT NULL DEFAULT 'NONE';
