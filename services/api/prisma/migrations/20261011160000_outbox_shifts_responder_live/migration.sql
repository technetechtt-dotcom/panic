-- Durable outbox, scheduler locks, operator shifts, responder live location

ALTER TABLE "ResponderAssignment" ADD COLUMN IF NOT EXISTS "lastLatitude" DOUBLE PRECISION;
ALTER TABLE "ResponderAssignment" ADD COLUMN IF NOT EXISTS "lastLongitude" DOUBLE PRECISION;
ALTER TABLE "ResponderAssignment" ADD COLUMN IF NOT EXISTS "lastLocationAt" TIMESTAMP(3);
ALTER TABLE "ResponderAssignment" ADD COLUMN IF NOT EXISTS "speedMps" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "OutboxEvent" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OutboxEvent_status_nextAttemptAt_idx" ON "OutboxEvent"("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "OutboxEvent_aggregateType_aggregateId_idx" ON "OutboxEvent"("aggregateType", "aggregateId");

CREATE TABLE IF NOT EXISTS "OutboxDeadLetter" (
    "id" UUID NOT NULL,
    "outboxEventId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL,
    "lastError" TEXT NOT NULL,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutboxDeadLetter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OutboxDeadLetter_outboxEventId_key" ON "OutboxDeadLetter"("outboxEventId");

CREATE TABLE IF NOT EXISTS "SchedulerLock" (
    "name" TEXT NOT NULL,
    "lockedBy" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SchedulerLock_pkey" PRIMARY KEY ("name")
);

CREATE TABLE IF NOT EXISTS "OperatorShift" (
    "id" UUID NOT NULL,
    "operatorId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "readyAt" TIMESTAMP(3),
    "handoverNote" TEXT,
    "handoverToId" UUID,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperatorShift_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OperatorShift_operatorId_status_idx" ON "OperatorShift"("operatorId", "status");
CREATE INDEX IF NOT EXISTS "OperatorShift_status_idx" ON "OperatorShift"("status");
