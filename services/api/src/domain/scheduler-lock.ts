import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";

/** Exclusive lease so only one of two API replicas runs a named sweep. */
export class SchedulerLockService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis | null,
    private readonly ownerId: string,
  ) {}

  async tryAcquire(name: string, ttlMs: number, now = new Date()): Promise<boolean> {
    const until = new Date(now.getTime() + ttlMs);
    if (this.redis) {
      try {
        const key = `guardian:lock:${name}`;
        const result = await this.redis.set(key, this.ownerId, "PX", ttlMs, "NX");
        if (result === "OK") return true;
        const holder = await this.redis.get(key);
        return holder === this.ownerId;
      } catch {
        // Fall through to Postgres when Redis is down.
      }
    }
    try {
      const rows = await this.prisma.$executeRaw`
        INSERT INTO "SchedulerLock" ("name", "lockedBy", "lockedUntil", "updatedAt")
        VALUES (${name}, ${this.ownerId}, ${until}, ${now})
        ON CONFLICT ("name") DO UPDATE
        SET "lockedBy" = EXCLUDED."lockedBy",
            "lockedUntil" = EXCLUDED."lockedUntil",
            "updatedAt" = EXCLUDED."updatedAt"
        WHERE "SchedulerLock"."lockedUntil" < ${now}
           OR "SchedulerLock"."lockedBy" = ${this.ownerId}
      `;
      return rows > 0;
    } catch {
      return false;
    }
  }

  async release(name: string): Promise<void> {
    if (this.redis) {
      try {
        const key = `guardian:lock:${name}`;
        const holder = await this.redis.get(key);
        if (holder === this.ownerId) await this.redis.del(key);
      } catch {
        // ignore
      }
    }
    try {
      await this.prisma.schedulerLock.deleteMany({ where: { name, lockedBy: this.ownerId } });
    } catch {
      // ignore
    }
  }
}

export function outboxBackoffMs(attempt: number): number {
  const base = Math.min(15 * 60_000, 2_000 * 2 ** Math.max(0, attempt - 1));
  return base + Math.floor(Math.random() * 500);
}

export function etaSeconds(distanceMeters: number, speedMps: number | null | undefined): number | null {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return null;
  const speed = speedMps && speedMps > 0.3 ? speedMps : 1.4;
  return Math.round(distanceMeters / speed);
}
