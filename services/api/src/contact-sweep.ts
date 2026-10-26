import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { AppConfig } from "./config";
import { APP_CONFIG } from "./common/tokens";
import { IncidentService } from "./domain/incident-service";
import { PlatformService } from "./domain/platform-service";
import { ProtectionService } from "./domain/protection-service";
import { SchedulerLockService } from "./domain/scheduler-lock";
import { RealtimeGateway } from "./modules/realtime/realtime.gateway";

@Injectable()
export class ContactSweep implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

  constructor(
    @Inject(IncidentService) private readonly incidents: IncidentService,
    @Inject(ProtectionService) private readonly protection: ProtectionService,
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(SchedulerLockService) private readonly locks: SchedulerLockService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.nodeEnv === "test") return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 15_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    const held = await this.locks.tryAcquire("contact-sweep", 14_000);
    if (!held) {
      // Still process a small outbox slice without the sweep lock so a stuck replica does not starve deliveries forever.
      await this.platform.processOutboxBatch(this.workerId).catch((error: unknown) => {
        console.error(JSON.stringify({ level: "error", message: "outbox drain failed", detail: String(error) }));
      });
      await this.recheckOperators();
      return;
    }
    try {
      await this.incidents.sweepStaleContacts().catch((error: unknown) => {
        console.error(JSON.stringify({ level: "error", message: "contact sweep failed", detail: String(error) }));
      });
      await this.protection.sweepJourneys().catch((error: unknown) => {
        console.error(JSON.stringify({ level: "error", message: "journey sweep failed", detail: String(error) }));
      });
      await this.platform.sweepUnackedSos().catch((error: unknown) => {
        console.error(JSON.stringify({ level: "error", message: "unacked SOS sweep failed", detail: String(error) }));
      });
      await this.platform.processOutboxBatch(this.workerId).catch((error: unknown) => {
        console.error(JSON.stringify({ level: "error", message: "outbox drain failed", detail: String(error) }));
      });
      await this.recheckOperators();
    } finally {
      await this.locks.release("contact-sweep").catch(() => undefined);
    }
  }

  private async recheckOperators(): Promise<void> {
    await this.realtime.dropRevokedOperators().catch((error: unknown) => {
      console.error(JSON.stringify({ level: "error", message: "operator socket recheck failed", detail: String(error) }));
    });
  }
}
