import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  createIncidentSchema,
  heartbeatSchema,
  locationBatchSchema,
  operatorActionSchema,
} from "@guardian/shared-validation";
import { RequirePermissions, type RequestWithUser } from "../../common/guards";
import { parseBody, requestContext } from "../../common/http";
import { SlidingWindowRateLimiter } from "../../common/rate-limit";
import { AppError } from "../../domain/errors";
import { IncidentService } from "../../domain/incident-service";
import type { Actor } from "../../domain/ports";
import { Permission } from "../../domain/rbac";

@Controller("incidents")
export class IncidentsController {
  private readonly limiter = new SlidingWindowRateLimiter();

  constructor(@Inject(IncidentService) private readonly incidents: IncidentService) {}

  @Post()
  @RequirePermissions(Permission.IncidentCreateOwn)
  async create(@Body() body: unknown, @Req() request: RequestWithUser, @Res({ passthrough: true }) response: Response) {
    this.enforce(`sos:${request.user!.id}`, 12, 60 * 1000);
    const result = await this.incidents.create(actorFrom(request), parseBody(createIncidentSchema, body), requestId());
    if (result.replayed) {
      response.status(200);
      response.setHeader("Idempotent-Replayed", "true");
    } else if (result.escalated) {
      response.status(200);
      response.setHeader("Incident-Escalated", "true");
    } else {
      response.status(201);
    }
    return { data: result.incident, replayed: result.replayed, escalated: result.escalated };
  }

  @Get()
  list(@Req() request: RequestWithUser) {
    return this.incidents.listForActor(actorFrom(request)).then((data) => ({ data }));
  }

  @Get("summary")
  @RequirePermissions(Permission.IncidentReadActive)
  summary(@Req() request: RequestWithUser) {
    return this.incidents.summary(actorFrom(request)).then((data) => ({ data }));
  }

  @Get(":id")
  get(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.incidents.get(actorFrom(request), id).then((data) => ({ data }));
  }

  @Post(":id/locations")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentCreateOwn)
  async locations(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithUser) {
    this.enforce(`loc:${request.user!.id}`, 600, 60 * 60 * 1000);
    const data = await this.incidents.addLocations(
      actorFrom(request),
      id,
      parseBody(locationBatchSchema, body),
      requestId(),
    );
    return { data };
  }

  @Post(":id/heartbeats")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentCreateOwn)
  async heartbeats(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithUser) {
    this.enforce(`hb:${request.user!.id}`, 600, 60 * 60 * 1000);
    const data = await this.incidents.addHeartbeat(
      actorFrom(request),
      id,
      parseBody(heartbeatSchema, body),
      requestId(),
    );
    return { data };
  }

  @Get(":id/timeline")
  timeline(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.incidents.timelineFor(actorFrom(request), id).then((data) => ({ data }));
  }

  @Get(":id/locations")
  locationHistory(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.incidents.locationsFor(actorFrom(request), id).then((data) => ({ data }));
  }

  @Get(":id/heartbeats")
  heartbeatHistory(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.incidents.heartbeatsFor(actorFrom(request), id).then((data) => ({ data }));
  }

  @Post(":id/acknowledge")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentAcknowledge)
  acknowledge(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithUser) {
    const input = parseBody(operatorActionSchema, body ?? {});
    return this.incidents
      .acknowledge(actorFrom(request), id, input.note, requestId())
      .then((data) => ({ data }));
  }

  @Post(":id/resolve")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentResolve)
  resolve(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithUser) {
    const input = parseBody(operatorActionSchema, body ?? {});
    return this.incidents.resolve(actorFrom(request), id, input.note, requestId()).then((data) => ({ data }));
  }

  private enforce(key: string, limit: number, windowMs: number): void {
    if (!this.limiter.allow(key, limit, windowMs)) {
      throw new AppError("RATE_LIMITED", 429, "Too many requests. The saved emergency is still retried by the device.");
    }
  }
}

function actorFrom(request: RequestWithUser): Actor {
  const user = request.user!;
  return { id: user.id, role: user.role, displayName: user.displayName };
}

function requestId(): string | null {
  return requestContext.getStore()?.requestId ?? null;
}
