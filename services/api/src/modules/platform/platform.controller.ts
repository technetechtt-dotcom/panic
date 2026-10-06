import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import {
  eraseAccountSchema,
  fusionSignalSchema,
  mfaCodeSchema,
  positionSchema,
  profileSchema,
  responderAssignSchema,
  responderStatusSchema,
  roleChangeSchema,
} from "@guardian/shared-validation";
import { Public, RequirePermissions, type RequestWithUser } from "../../common/guards";
import { parseBody, requestContext } from "../../common/http";
import { PlatformService } from "../../domain/platform-service";
import type { Actor } from "../../domain/ports";
import { Permission } from "../../domain/rbac";

@Controller()
export class PlatformController {
  constructor(@Inject(PlatformService) private readonly platform: PlatformService) {}

  @Get("incidents/:id/brief")
  @RequirePermissions(Permission.IncidentReadActive)
  brief(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.platform.brief(actorFrom(request), id).then((data) => ({ data }));
  }

  @Get("incidents/:id/corridor")
  @RequirePermissions(Permission.IncidentReadActive)
  corridor(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.platform.corridor(actorFrom(request), id).then((data) => ({ data }));
  }

  @Get("incidents/:id/evidence")
  @RequirePermissions(Permission.IncidentReadActive)
  evidence(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.platform.evidence(actorFrom(request), id).then((data) => ({ data }));
  }

  @Get("incidents/:id/evidence/:chunkId")
  @RequirePermissions(Permission.IncidentReadActive)
  evidenceFile(@Param("id") id: string, @Param("chunkId") chunkId: string, @Req() request: RequestWithUser) {
    return this.platform.evidenceBytes(actorFrom(request), id, chunkId).then((file) => ({
      data: { contentType: file.contentType, bytesBase64: file.bytes.toString("base64") },
    }));
  }

  @Post("incidents/:id/responders")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentAcknowledge)
  assign(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithUser) {
    const input = parseBody(responderAssignSchema, body);
    return this.platform.assign(actorFrom(request), id, input.responderId, requestContext.getStore()?.requestId ?? null).then((data) => ({ data }));
  }

  @Post("incidents/:id/responder-status")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentRespond)
  status(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithUser) {
    const input = parseBody(responderStatusSchema, body);
    return this.platform
      .responderStatus(actorFrom(request), id, input.status, requestContext.getStore()?.requestId ?? null)
      .then((data) => ({ data }));
  }

  @Post("protection/signals")
  @HttpCode(200)
  @RequirePermissions(Permission.ProtectionManageOwn)
  signals(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.platform.signals(actorFrom(request), parseBody(fusionSignalSchema, body).signals).then((data) => ({ data }));
  }

  @Post("journeys/:id/position")
  @HttpCode(200)
  @RequirePermissions(Permission.ProtectionManageOwn)
  position(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithUser) {
    const input = parseBody(positionSchema, body);
    return this.platform.position(actorFrom(request), id, input.latitude, input.longitude).then((data) => ({ data }));
  }

  @Get("users/me/profile")
  @RequirePermissions(Permission.UserReadSelf)
  profile(@Req() request: RequestWithUser) {
    return this.platform.profile(actorFrom(request)).then((data) => ({ data }));
  }

  @Post("users/me/profile")
  @RequirePermissions(Permission.ProtectionManageOwn)
  saveProfile(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.platform.saveProfile(actorFrom(request), parseBody(profileSchema, body)).then((data) => ({ data }));
  }

  @Get("users/me/export")
  @RequirePermissions(Permission.UserReadSelf)
  exportAccount(@Req() request: RequestWithUser) {
    return this.platform.exportAccount(actorFrom(request)).then((data) => ({ data }));
  }

  @Post("users/me/erase")
  @HttpCode(200)
  @RequirePermissions(Permission.UserReadSelf)
  erase(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.platform.eraseAccount(actorFrom(request), parseBody(eraseAccountSchema, body).password).then((data) => ({ data }));
  }

  @Post("auth/mfa/setup")
  @RequirePermissions(Permission.UserReadSelf)
  setup(@Req() request: RequestWithUser) {
    return this.platform.beginMfa(actorFrom(request)).then((data) => ({ data }));
  }

  @Post("auth/mfa/confirm")
  @HttpCode(200)
  @RequirePermissions(Permission.UserReadSelf)
  confirm(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.platform.confirmMfa(actorFrom(request), parseBody(mfaCodeSchema, body).code).then((data) => ({ data }));
  }

  @Get("admin/users")
  @RequirePermissions(Permission.UserManage)
  users(@Req() request: RequestWithUser) {
    return this.platform.listUsers(actorFrom(request)).then((data) => ({ data }));
  }

  @Post("admin/users/:id/role")
  @HttpCode(200)
  @RequirePermissions(Permission.UserManage)
  setRole(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithUser) {
    const input = parseBody(roleChangeSchema, body);
    return this.platform.setRole(actorFrom(request), id, input.role).then((data) => ({ data }));
  }

  @Get("admin/platform")
  @RequirePermissions(Permission.PlatformRead)
  platformStatus(@Req() request: RequestWithUser) {
    return this.platform.platformStatus(actorFrom(request)).then((data) => ({ data }));
  }

  @Post("incidents/:id/emergency-services")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentAcknowledge)
  emergency(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.platform
      .emergencyHandoff(actorFrom(request), id, requestContext.getStore()?.requestId ?? null)
      .then((data) => ({ data }));
  }

  @Public()
  @Get("rooms/:token")
  room(@Param("token") token: string) {
    return this.platform.room(token).then((data) => ({ data }));
  }
}

function actorFrom(request: RequestWithUser): Actor {
  const user = request.user!;
  return { id: user.id, role: user.role, displayName: user.displayName };
}
