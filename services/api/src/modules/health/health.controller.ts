import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import type { AppConfig } from "../../config";
import { Public } from "../../common/guards";
import { requestMetrics } from "../../common/http";
import { APP_CONFIG } from "../../common/tokens";
import { PrismaService } from "../../infra/prisma.service";
import { RedisService } from "../../infra/redis.service";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get()
  async health(@Res({ passthrough: true }) response: Response) {
    const snapshot = await this.snapshot();
    if (snapshot.status === "down") response.status(503);
    return { data: snapshot };
  }

  @Public()
  @Get("ready")
  async ready(@Res({ passthrough: true }) response: Response) {
    const snapshot = await this.snapshot();
    if (snapshot.postgres !== "up") response.status(503);
    return { data: { ready: snapshot.postgres === "up", postgres: snapshot.postgres, redis: snapshot.redis } };
  }

  @Public()
  @Get("metrics")
  async metrics(@Res() response: Response) {
    const snapshot = await this.snapshot();
    response.type("text/plain").send(
      [
        "# HELP guardian_http_requests_total HTTP requests observed by this process.",
        "# TYPE guardian_http_requests_total counter",
        `guardian_http_requests_total ${requestMetrics.total}`,
        "# HELP guardian_http_server_errors_total Unhandled server errors.",
        "# TYPE guardian_http_server_errors_total counter",
        `guardian_http_server_errors_total ${requestMetrics.serverErrors}`,
        "# HELP guardian_process_uptime_seconds Process uptime.",
        "# TYPE guardian_process_uptime_seconds gauge",
        `guardian_process_uptime_seconds ${process.uptime().toFixed(0)}`,
        "# HELP guardian_postgres_up 1 when this process can query Postgres.",
        "# TYPE guardian_postgres_up gauge",
        `guardian_postgres_up ${snapshot.postgres === "up" ? 1 : 0}`,
        "# HELP guardian_redis_up 1 when Redis answers PING. 0 means unused or down.",
        "# TYPE guardian_redis_up gauge",
        `guardian_redis_up ${snapshot.redis === "up" ? 1 : 0}`,
        "",
      ].join("\n"),
    );
  }

  private async snapshot() {
    let postgres: "up" | "down" = "down";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      postgres = "up";
    } catch {
      postgres = "down";
    }
    const redis = await this.redis.ping();
    const status = postgres === "up" ? (redis === "down" ? "degraded" : "ok") : "down";
    return {
      status,
      postgres,
      redis,
      version: "0.1.0",
      environment: this.config.nodeEnv,
    };
  }
}
