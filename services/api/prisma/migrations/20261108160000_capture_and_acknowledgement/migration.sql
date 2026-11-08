-- AlterTable
ALTER TABLE "EvidenceChunk" ADD COLUMN     "artifactId" UUID,
ADD COLUMN     "chunkIndex" INTEGER;

-- CreateTable
CREATE TABLE "GuardianAcknowledgement" (
    "incidentId" UUID NOT NULL,
    "trustedContactId" UUID NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuardianAcknowledgement_pkey" PRIMARY KEY ("incidentId","trustedContactId")
);

-- CreateTable
CREATE TABLE "EvidenceArtifact" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "captureId" UUID NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "contentType" TEXT NOT NULL,
    "totalSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "chunkCount" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceArtifact_incidentId_captureId_key" ON "EvidenceArtifact"("incidentId", "captureId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceChunk_artifactId_chunkIndex_key" ON "EvidenceChunk"("artifactId", "chunkIndex");

-- AddForeignKey
ALTER TABLE "GuardianAcknowledgement" ADD CONSTRAINT "GuardianAcknowledgement_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceChunk" ADD CONSTRAINT "EvidenceChunk_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "EvidenceArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

