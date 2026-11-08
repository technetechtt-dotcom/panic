ALTER TABLE "OperatorMfa"
ADD COLUMN "pendingSecret" TEXT,
ADD COLUMN "pendingExpiresAt" TIMESTAMP(3);
