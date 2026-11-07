ALTER TABLE "EvidenceChunk"
  ADD COLUMN "retentionUntil" TIMESTAMP(3),
  ADD COLUMN "legalHold" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "retentionPolicy" TEXT NOT NULL DEFAULT 'STANDARD';

CREATE INDEX "EvidenceChunk_retentionUntil_legalHold_idx"
  ON "EvidenceChunk"("retentionUntil", "legalHold");
