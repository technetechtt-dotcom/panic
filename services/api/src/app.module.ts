import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { loadConfig, type AppConfig } from "./config";
import { AuthGuard, PermissionsGuard } from "./common/guards";
import {
  ACCESS_TOKENS,
  APP_CONFIG,
  AUDIT_STORE,
  CLOCK,
  CONSENT_STORE,
  DEVICE_STORE,
  HEARTBEAT_STORE,
  IDS,
  INCIDENT_STORE,
  LOCATION_STORE,
  PASSWORD_HASHER,
  REFRESH_STORE,
  TIMELINE_STORE,
  USER_STORE,
} from "./common/tokens";
import { ContactSweep } from "./contact-sweep";
import { AuthService } from "./domain/auth-service";
import { DeviceService } from "./domain/device-service";
import { IncidentService } from "./domain/incident-service";
import { FileEvidenceVault } from "./domain/evidence-vault";
import { FusionBridge } from "./domain/fusion-bridge";
import { PlatformService, PrismaMfaStore } from "./domain/platform-service";
import { ProtectionService } from "./domain/protection-service";
import type { AuditStore, Clock, IdGenerator } from "./domain/ports";
import { JwtAccessTokens, ScryptPasswordHasher } from "./domain/security";
import {
  PrismaAuditStore,
  PrismaConsentStore,
  PrismaDeviceStore,
  PrismaHeartbeatStore,
  PrismaIncidentStore,
  PrismaLocationStore,
  PrismaRefreshTokenStore,
  PrismaTimelineStore,
  PrismaUserStore,
} from "./infra/prisma-stores";
import {
  PrismaEvidenceStore,
  PrismaGuardianStore,
  PrismaJourneyStore,
  PrismaPinStore,
  PrismaRiskStore,
} from "./infra/prisma-protection";
import { PrismaService } from "./infra/prisma.service";
import { RedisService } from "./infra/redis.service";
import { AuditController } from "./modules/audit/audit.controller";
import { AuthController } from "./modules/auth/auth.controller";
import { DevicesController } from "./modules/devices/devices.controller";
import { HealthController } from "./modules/health/health.controller";
import { IncidentsController } from "./modules/incidents/incidents.controller";
import { PlatformController } from "./modules/platform/platform.controller";
import { ProtectionController } from "./modules/protection/protection.controller";
import { RealtimeGateway } from "./modules/realtime/realtime.gateway";
import { UsersController } from "./modules/users/users.controller";

@Module({
  controllers: [
    AuthController,
    UsersController,
    DevicesController,
    IncidentsController,
    ProtectionController,
    PlatformController,
    AuditController,
    HealthController,
  ],
  providers: [
    PrismaService,
    { provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() },
    { provide: CLOCK, useValue: { now: () => new Date() } satisfies Clock },
    { provide: IDS, useValue: { uuid: () => randomUUID() } satisfies IdGenerator },
    { provide: PASSWORD_HASHER, useValue: new ScryptPasswordHasher() },
    {
      provide: ACCESS_TOKENS,
      useFactory: (config: AppConfig) => new JwtAccessTokens(config.jwtSecret, config.accessTtlSeconds),
      inject: [APP_CONFIG],
    },
    {
      provide: RedisService,
      useFactory: (config: AppConfig) => new RedisService(config),
      inject: [APP_CONFIG],
    },
    { provide: USER_STORE, useFactory: (prisma: PrismaService) => new PrismaUserStore(prisma), inject: [PrismaService] },
    {
      provide: REFRESH_STORE,
      useFactory: (prisma: PrismaService) => new PrismaRefreshTokenStore(prisma),
      inject: [PrismaService],
    },
    {
      provide: CONSENT_STORE,
      useFactory: (prisma: PrismaService) => new PrismaConsentStore(prisma),
      inject: [PrismaService],
    },
    { provide: DEVICE_STORE, useFactory: (prisma: PrismaService) => new PrismaDeviceStore(prisma), inject: [PrismaService] },
    {
      provide: INCIDENT_STORE,
      useFactory: (prisma: PrismaService) => new PrismaIncidentStore(prisma),
      inject: [PrismaService],
    },
    {
      provide: LOCATION_STORE,
      useFactory: (prisma: PrismaService) => new PrismaLocationStore(prisma),
      inject: [PrismaService],
    },
    {
      provide: HEARTBEAT_STORE,
      useFactory: (prisma: PrismaService) => new PrismaHeartbeatStore(prisma),
      inject: [PrismaService],
    },
    {
      provide: TIMELINE_STORE,
      useFactory: (prisma: PrismaService) => new PrismaTimelineStore(prisma),
      inject: [PrismaService],
    },
    { provide: AUDIT_STORE, useFactory: (prisma: PrismaService) => new PrismaAuditStore(prisma), inject: [PrismaService] },
    {
      provide: AuthService,
      useFactory: (users, refreshTokens, consents, passwords, tokens, ids: IdGenerator, clock: Clock, config: AppConfig, audit: AuditStore, prisma: PrismaService) =>
        new AuthService(
          users,
          refreshTokens,
          consents,
          passwords,
          tokens,
          ids,
          clock,
          config.refreshTtlDays,
          config.accessTtlSeconds,
          async (event) => {
            await audit.append({
              id: ids.uuid(),
              actorId: event.actorId,
              action: event.action,
              entityType: "User",
              entityId: event.entityId,
              correlationId: null,
              requestId: null,
              metadata: event.metadata ?? null,
              createdAt: clock.now(),
            });
          },
          { store: new PrismaMfaStore(prisma), secret: config.jwtSecret },
        ),
      inject: [USER_STORE, REFRESH_STORE, CONSENT_STORE, PASSWORD_HASHER, ACCESS_TOKENS, IDS, CLOCK, APP_CONFIG, AUDIT_STORE, PrismaService],
    },
    FusionBridge,
    {
      provide: FileEvidenceVault,
      useFactory: (config: AppConfig) =>
        new FileEvidenceVault(process.env.EVIDENCE_VAULT_DIR || "data/evidence-vault", process.env.EVIDENCE_VAULT_KEY || config.jwtSecret),
      inject: [APP_CONFIG],
    },
    RealtimeGateway,
    {
      provide: IncidentService,
      useFactory: (
        incidents,
        devices,
        locations,
        heartbeats,
        timeline,
        audit,
        publisher: RealtimeGateway,
        ids,
        clock,
        config: AppConfig,
        users,
        bridge: FusionBridge,
      ) => {
        const service = new IncidentService(
          incidents,
          devices,
          locations,
          heartbeats,
          timeline,
          audit,
          publisher,
          ids,
          clock,
          config.staleAfterSeconds,
          users,
        );
        bridge.handler = (userId, triggerType) => service.raiseFromFusion(userId, triggerType);
        return service;
      },
      inject: [
        INCIDENT_STORE,
        DEVICE_STORE,
        LOCATION_STORE,
        HEARTBEAT_STORE,
        TIMELINE_STORE,
        AUDIT_STORE,
        RealtimeGateway,
        IDS,
        CLOCK,
        APP_CONFIG,
        USER_STORE,
        FusionBridge,
      ],
    },
    {
      provide: DeviceService,
      useFactory: (devices, audit, ids, clock) => new DeviceService(devices, audit, ids, clock),
      inject: [DEVICE_STORE, AUDIT_STORE, IDS, CLOCK],
    },
    {
      provide: ProtectionService,
      useFactory: (
        prisma: PrismaService,
        incidents,
        timeline,
        audit,
        publisher: RealtimeGateway,
        passwords,
        ids,
        clock,
        bridge: FusionBridge,
        vault: FileEvidenceVault,
      ) =>
        new ProtectionService(
          new PrismaGuardianStore(prisma),
          new PrismaJourneyStore(prisma),
          new PrismaRiskStore(prisma),
          new PrismaPinStore(prisma),
          new PrismaEvidenceStore(prisma),
          incidents,
          timeline,
          audit,
          publisher,
          passwords,
          ids,
          clock,
          bridge,
          vault,
        ),
      inject: [PrismaService, INCIDENT_STORE, TIMELINE_STORE, AUDIT_STORE, RealtimeGateway, PASSWORD_HASHER, IDS, CLOCK, FusionBridge, FileEvidenceVault],
    },
    {
      provide: PlatformService,
      useFactory: (prisma: PrismaService, incidents: IncidentService, protection: ProtectionService, users, devices, passwords, ids, clock, config: AppConfig, vault: FileEvidenceVault) =>
        new PlatformService(prisma, incidents, protection, users, devices, passwords, ids, clock, config, vault),
      inject: [PrismaService, IncidentService, ProtectionService, USER_STORE, DEVICE_STORE, PASSWORD_HASHER, IDS, CLOCK, APP_CONFIG, FileEvidenceVault],
    },
    ContactSweep,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
