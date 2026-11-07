ALTER TABLE "User" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

CREATE TABLE "OperatorMfaRecoveryCode" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "codeHash" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatorMfaRecoveryCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OperatorMfaRecoveryCode_codeHash_key" ON "OperatorMfaRecoveryCode"("codeHash");
CREATE INDEX "OperatorMfaRecoveryCode_userId_usedAt_idx" ON "OperatorMfaRecoveryCode"("userId", "usedAt");
ALTER TABLE "OperatorMfaRecoveryCode" ADD CONSTRAINT "OperatorMfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
