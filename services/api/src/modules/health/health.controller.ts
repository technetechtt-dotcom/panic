import { Controller, Get, Inject, Res } from "@nestjs/common";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
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
    const redisRequired = this.config.nodeEnv === "production";
    const ready = snapshot.postgres === "up" && (!redisRequired || snapshot.redis === "up");
    if (!ready) response.status(503);
    return { data: { ready, postgres: snapshot.postgres, redis: snapshot.redis } };
  }

  @Public()
  @Get("metrics")
  async metrics(@Res() response: Response) {
    const snapshot = await this.snapshot();
    const operations = await this.operationalMetrics();
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
        "# HELP guardian_active_incidents Current non-test incidents that are still active.",
        "# TYPE guardian_active_incidents gauge",
        `guardian_active_incidents ${operations.activeIncidents}`,
        "# HELP guardian_unacknowledged_sos Current non-test SOS incidents without operator acknowledgement.",
        "# TYPE guardian_unacknowledged_sos gauge",
        `guardian_unacknowledged_sos ${operations.unacknowledgedSos}`,
        "# HELP guardian_outbox_pending Pending or failed durable outbox events.",
        "# TYPE guardian_outbox_pending gauge",
        `guardian_outbox_pending ${operations.outboxPending}`,
        "# HELP guardian_outbox_oldest_age_seconds Age of the oldest retryable outbox event.",
        "# TYPE guardian_outbox_oldest_age_seconds gauge",
        `guardian_outbox_oldest_age_seconds ${operations.oldestOutboxAgeSeconds}`,
        "# HELP guardian_outbox_dead_letters_total Current dead-letter rows.",
        "# TYPE guardian_outbox_dead_letters_total gauge",
        `guardian_outbox_dead_letters_total ${operations.deadLetters}`,
        "# HELP guardian_evidence_expired_pending Current evidence chunks past retention but not under legal hold.",
        "# TYPE guardian_evidence_expired_pending gauge",
        `guardian_evidence_expired_pending ${operations.expiredEvidence}`,
        "# HELP guardian_postgres_probe_latency_ms Latest Postgres SELECT probe latency.",
        "# TYPE guardian_postgres_probe_latency_ms gauge",
        `guardian_postgres_probe_latency_ms ${snapshot.postgresLatencyMs}`,
        "# HELP guardian_backup_age_seconds Age of newest encrypted database backup; -1 means unavailable.",
        "# TYPE guardian_backup_age_seconds gauge",
        `guardian_backup_age_seconds ${operations.backupAgeSeconds}`,

        "",
      ].join("\n"),
    );
  }

  private async snapshot() {
    let postgres: "up" | "down" = "down";
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      postgres = "up";
    } catch {
      postgres = "down";
    }
    const postgresLatencyMs = Date.now() - started;
    const redis = await this.redis.ping();
    const status = postgres === "up" ? (redis === "down" ? "degraded" : "ok") : "down";
    return {
      status,
      postgres,
      postgresLatencyMs,
      redis,
      version: "0.1.0",
      environment: this.config.nodeEnv,
    };
  }

  private async operationalMetrics() {
    const now = new Date();
    const [activeIncidents, unacknowledgedSos, outboxPending, oldestOutbox, deadLetters, expiredEvidence] = await Promise.all([
      this.prisma.incident.count({
        where: {
          isTest: false,
          state: { in: ["CONCERN", "HIGH_RISK", "SOS", "ACKNOWLEDGED", "RESPONDING", "USER_LOCATED"] },
        },
      }),
      this.prisma.incident.count({ where: { isTest: false, state: "SOS", acknowledgedAt: null } }),
      this.prisma.outboxEvent.count({ where: { status: { in: ["PENDING", "FAILED", "PROCESSING"] } } }),
      this.prisma.outboxEvent.findFirst({
        where: { status: { in: ["PENDING", "FAILED"] } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      this.prisma.outboxDeadLetter.count(),
      this.prisma.evidenceChunk.count({ where: { legalHold: false, retentionUntil: { lte: now } } }),
    ]);
    return {
      activeIncidents,
      unacknowledgedSos,
      outboxPending,
      oldestOutboxAgeSeconds: oldestOutbox ? Math.max(0, Math.floor((now.getTime() - oldestOutbox.createdAt.getTime()) / 1000)) : 0,
      deadLetters,
      expiredEvidence,
      backupAgeSeconds: await this.backupAgeSeconds(),
    };
  }

  private async backupAgeSeconds(): Promise<number> {
    const directory = process.env.BACKUP_STATUS_DIR?.trim();
    if (!directory) return -1;
    try {
      const names = (await readdir(directory)).filter((name) => name.startsWith("guardian-") && name.endsWith(".sql.enc"));
      if (!names.length) return -1;
      const rows = await Promise.all(names.map(async (name) => stat(join(directory, name))));
      const newest = Math.max(...rows.map((row) => row.mtimeMs));
      return Math.max(0, Math.floor((Date.now() - newest) / 1000));
    } catch {
      return -1;
    }
  }
}
