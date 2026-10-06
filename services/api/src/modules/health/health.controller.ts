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
    let postgres: "up" | "down" = "down";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      postgres = "up";
    } catch {
      postgres = "down";
    }
    const redis = await this.redis.ping();
    const status = postgres === "up" ? (redis === "down" ? "degraded" : "ok") : "down";
    if (status === "down") response.status(503);
    return {
      data: {
        status,
        postgres,
        redis,
        version: "0.1.0",
        environment: this.config.nodeEnv,
      },
    };
  }

  @Public()
  @Get("metrics")
  metrics(@Res() response: Response) {
    response.type("text/plain").send(
      [
        "# HELP guardian_http_requests_total HTTP requests observed by this process.",
        "# TYPE guardian_http_requests_total counter",
        `guardian_http_requests_total ${requestMetrics.total}`,
        "# HELP guardian_http_server_errors_total Unhandled server errors.",
        "# TYPE guardian_http_server_errors_total counter",
        `guardian_http_server_errors_total ${requestMetrics.serverErrors}`,
        "",
      ].join("\n"),
    );
  }
}
