import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { AppConfig } from "./config";
import { APP_CONFIG } from "./common/tokens";
import { IncidentService } from "./domain/incident-service";

@Injectable()
export class ContactSweep implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(IncidentService) private readonly incidents: IncidentService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.nodeEnv === "test") return;
    this.timer = setInterval(() => {
      void this.incidents.sweepStaleContacts().catch((error: unknown) => {
        console.error(JSON.stringify({ level: "error", message: "contact sweep failed", detail: String(error) }));
      });
    }, 15_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
