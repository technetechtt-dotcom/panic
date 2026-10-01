import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import type { AppConfig } from "../config";

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis | null;

  constructor(config: AppConfig) {
    this.client = config.redisUrl
      ? new Redis(config.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          retryStrategy: () => null,
        })
      : null;
    this.client?.on("error", () => undefined);
  }

  async ping(): Promise<"up" | "down" | "unconfigured"> {
    if (!this.client) return "unconfigured";
    try {
      if (this.client.status === "wait") await this.client.connect();
      const result = await this.client.ping();
      return result === "PONG" ? "up" : "down";
    } catch {
      return "down";
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.quit().catch(() => undefined);
  }
}
