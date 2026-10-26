import type { Prisma, PrismaClient } from "@prisma/client";
import type { IdGenerator, Clock } from "./ports";
import { outboxBackoffMs } from "./scheduler-lock";

export type OutboxPayload = Record<string, unknown>;

export class OutboxService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async enqueue(input: {
    type: string;
    aggregateType: string;
    aggregateId: string;
    payload: OutboxPayload;
    maxAttempts?: number;
  }): Promise<string> {
    const now = this.clock.now();
    const id = this.ids.uuid();
    await this.prisma.outboxEvent.create({
      data: {
        id,
        type: input.type,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload as Prisma.InputJsonValue,
        status: "PENDING",
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 8,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    return id;
  }

  async claimBatch(workerId: string, limit = 20): Promise<Array<{
    id: string;
    type: string;
    aggregateType: string;
    aggregateId: string;
    payload: OutboxPayload;
    attempts: number;
    maxAttempts: number;
  }>> {
    const now = this.clock.now();
    const candidates = await this.prisma.outboxEvent.findMany({
      where: {
        status: { in: ["PENDING", "FAILED"] },
        nextAttemptAt: { lte: now },
        OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - 60_000) } }],
      },
      orderBy: { nextAttemptAt: "asc" },
      take: limit,
    });
    const claimed = [];
    for (const row of candidates) {
      const updated = await this.prisma.outboxEvent.updateMany({
        where: {
          id: row.id,
          status: { in: ["PENDING", "FAILED"] },
          OR: [{ lockedBy: null }, { lockedBy: workerId }, { lockedAt: { lt: new Date(now.getTime() - 60_000) } }],
        },
        data: {
          status: "PROCESSING",
          lockedBy: workerId,
          lockedAt: now,
          updatedAt: now,
        },
      });
      if (updated.count === 0) continue;
      claimed.push({
        id: row.id,
        type: row.type,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        payload: row.payload as OutboxPayload,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
      });
    }
    return claimed;
  }

  async markSent(id: string): Promise<void> {
    const now = this.clock.now();
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { status: "SENT", sentAt: now, lockedBy: null, lockedAt: null, lastError: null, updatedAt: now },
    });
  }

  async markFailure(id: string, error: string, attempts: number, maxAttempts: number, type: string, aggregateType: string, aggregateId: string, payload: OutboxPayload): Promise<"retry" | "dead"> {
    const now = this.clock.now();
    const nextAttempts = attempts + 1;
    if (nextAttempts >= maxAttempts) {
      await this.prisma.$transaction([
        this.prisma.outboxEvent.update({
          where: { id },
          data: { status: "DEAD", attempts: nextAttempts, lastError: error.slice(0, 1000), lockedBy: null, lockedAt: null, updatedAt: now },
        }),
        this.prisma.outboxDeadLetter.create({
          data: {
            id: this.ids.uuid(),
            outboxEventId: id,
            type,
            aggregateType,
            aggregateId,
            payload: payload as Prisma.InputJsonValue,
            attempts: nextAttempts,
            lastError: error.slice(0, 1000),
            failedAt: now,
            createdAt: now,
          },
        }),
      ]);
      return "dead";
    }
    await this.prisma.outboxEvent.update({
      where: { id },
      data: {
        status: "FAILED",
        attempts: nextAttempts,
        lastError: error.slice(0, 1000),
        nextAttemptAt: new Date(now.getTime() + outboxBackoffMs(nextAttempts)),
        lockedBy: null,
        lockedAt: null,
        updatedAt: now,
      },
    });
    return "retry";
  }

  async recentDead(limit = 8): Promise<Array<{ type: string; aggregateId: string; attempts: number; lastError: string; failedAt: string }>> {
    const rows = await this.prisma.outboxDeadLetter.findMany({
      orderBy: { failedAt: "desc" },
      take: limit,
      select: { type: true, aggregateId: true, attempts: true, lastError: true, failedAt: true },
    });
    return rows.map((row) => ({
      type: row.type,
      aggregateId: row.aggregateId,
      attempts: row.attempts,
      lastError: row.lastError,
      failedAt: row.failedAt.toISOString(),
    }));
  }

  async backlog(): Promise<{ pending: number; failed: number; dead: number; processing: number }> {
    const [pending, failed, dead, processing] = await Promise.all([
      this.prisma.outboxEvent.count({ where: { status: "PENDING" } }),
      this.prisma.outboxEvent.count({ where: { status: "FAILED" } }),
      this.prisma.outboxEvent.count({ where: { status: "DEAD" } }),
      this.prisma.outboxEvent.count({ where: { status: "PROCESSING" } }),
    ]);
    return { pending, failed, dead, processing };
  }
}
