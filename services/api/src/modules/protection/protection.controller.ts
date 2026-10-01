import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import {
  cancelIncidentSchema,
  evidenceChunkSchema,
  guardianSchema,
  journeySchema,
  safetyPinSchema,
} from "@guardian/shared-validation";
import { RequirePermissions, type RequestWithUser } from "../../common/guards";
import { parseBody, requestContext } from "../../common/http";
import { ProtectionService } from "../../domain/protection-service";
import type { Actor } from "../../domain/ports";
import { Permission } from "../../domain/rbac";

@Controller()
export class ProtectionController {
  constructor(@Inject(ProtectionService) private readonly protection: ProtectionService) {}

  @Post("guardians")
  @RequirePermissions(Permission.ProtectionManageOwn)
  addGuardian(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.protection.addGuardian(actorFrom(request), parseBody(guardianSchema, body), requestContext.getStore()?.requestId ?? null).then((data) => ({ data }));
  }

  @Get("guardians")
  @RequirePermissions(Permission.ProtectionManageOwn)
  guardians(@Req() request: RequestWithUser) {
    return this.protection.listGuardians(actorFrom(request)).then((data) => ({ data }));
  }

  @Delete("guardians/:id")
  @HttpCode(204)
  @RequirePermissions(Permission.ProtectionManageOwn)
  removeGuardian(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.protection.removeGuardian(actorFrom(request), id);
  }

  @Post("journeys")
  @RequirePermissions(Permission.ProtectionManageOwn)
  startJourney(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.protection.startJourney(actorFrom(request), parseBody(journeySchema, body)).then((data) => ({ data }));
  }

  @Post("journeys/:id/check-in")
  @HttpCode(200)
  @RequirePermissions(Permission.ProtectionManageOwn)
  checkIn(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.protection.checkIn(actorFrom(request), id).then((data) => ({ data }));
  }

  @Post("journeys/:id/complete")
  @HttpCode(200)
  @RequirePermissions(Permission.ProtectionManageOwn)
  complete(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.protection.completeJourney(actorFrom(request), id).then((data) => ({ data }));
  }

  @Post("safety-pins")
  @HttpCode(204)
  @RequirePermissions(Permission.ProtectionManageOwn)
  pins(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.protection.setPins(actorFrom(request), parseBody(safetyPinSchema, body));
  }

  @Post("incidents/:id/cancel")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentCreateOwn)
  cancel(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithUser) {
    return this.protection
      .cancel(actorFrom(request), id, parseBody(cancelIncidentSchema, body), requestContext.getStore()?.requestId ?? null)
      .then((data) => ({ data }));
  }

  @Post("incidents/:id/evidence")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentCreateOwn)
  evidence(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithUser) {
    return this.protection.addEvidence(actorFrom(request), id, parseBody(evidenceChunkSchema, body)).then((data) => ({ data }));
  }
}

function actorFrom(request: RequestWithUser): Actor {
  const user = request.user!;
  return { id: user.id, role: user.role, displayName: user.displayName };
}
