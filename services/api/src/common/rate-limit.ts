export interface CounterRedis {
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
}

export async function allowShared(
  redis: CounterRedis | null,
  memory: SlidingWindowRateLimiter,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  if (!redis) return memory.allow(key, limit, windowMs);
  try {
    const count = await redis.incr(`rl:${key}`);
    if (count === 1) await redis.pexpire(`rl:${key}`, windowMs);
    return count <= limit;
  } catch {
    return memory.allow(key, limit, windowMs);
  }
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
