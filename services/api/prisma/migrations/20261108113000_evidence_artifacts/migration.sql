CREATE TABLE "EvidenceArtifact" (
  "id" UUID NOT NULL,
  "incidentId" UUID NOT NULL,
  "clientCaptureId" UUID NOT NULL,
  "contentType" TEXT NOT NULL,
  "originalSha256" TEXT NOT NULL,
  "originalByteLength" INTEGER NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "chunkCount" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UPLOADING',
  "completedAt" TIMESTAMP(3),
  "retentionUntil" TIMESTAMP(3),
  "legalHold" BOOLEAN NOT NULL DEFAULT false,
  "retentionPolicy" TEXT NOT NULL DEFAULT 'STANDARD',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EvidenceArtifact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EvidenceArtifact_incidentId_clientCaptureId_key" ON "EvidenceArtifact"("incidentId","clientCaptureId");
CREATE INDEX "EvidenceArtifact_incidentId_capturedAt_idx" ON "EvidenceArtifact"("incidentId","capturedAt");
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EvidenceChunk" ADD COLUMN "artifactId" UUID;
ALTER TABLE "EvidenceChunk" ADD COLUMN "chunkIndex" INTEGER;
CREATE UNIQUE INDEX "EvidenceChunk_artifactId_chunkIndex_key" ON "EvidenceChunk"("artifactId","chunkIndex");
CREATE INDEX "EvidenceChunk_artifactId_chunkIndex_idx" ON "EvidenceChunk"("artifactId","chunkIndex");
ALTER TABLE "EvidenceChunk" ADD CONSTRAINT "EvidenceChunk_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "EvidenceArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
