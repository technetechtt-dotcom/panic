-- Explainable AI decisions. These rows are written after an incident exists.

CREATE TABLE IF NOT EXISTS "AiModel" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "datasetNote" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiModel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiModel_name_version_key" ON "AiModel"("name", "version");

CREATE TABLE IF NOT EXISTS "AiDecision" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "explanation" TEXT NOT NULL,
    "contributing" JSONB NOT NULL,
    "contradicting" JSONB NOT NULL,
    "featureSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiDecision_incidentId_mode_createdAt_idx" ON "AiDecision"("incidentId", "mode", "createdAt");

CREATE TABLE IF NOT EXISTS "AiRecommendation" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "decisionId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiRecommendation_incidentId_status_idx" ON "AiRecommendation"("incidentId", "status");

CREATE TABLE IF NOT EXISTS "AiIncidentSummary" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "changes" TEXT NOT NULL,
    "risks" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiIncidentSummary_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiIncidentSummary_incidentId_createdAt_idx" ON "AiIncidentSummary"("incidentId", "createdAt");

CREATE TABLE IF NOT EXISTS "AiReview" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiReview_incidentId_createdAt_idx" ON "AiReview"("incidentId", "createdAt");

CREATE TABLE IF NOT EXISTS "SearchPrediction" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "geometry" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SearchPrediction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SearchPrediction_incidentId_createdAt_idx" ON "SearchPrediction"("incidentId", "createdAt");
