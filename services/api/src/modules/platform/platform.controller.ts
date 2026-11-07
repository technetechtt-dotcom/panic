import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common";
import {
  eraseAccountSchema,
  fusionSignalSchema,
  mfaCodeSchema,
  operatorHandoverSchema,
  positionSchema,
  profileSchema,
  responderAssignSchema,
  responderLocationSchema,
  responderProfileSchema,
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

  @Get("incidents/:id/deliveries")
  @RequirePermissions(Permission.IncidentReadActive)
  deliveries(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.platform.deliveries(actorFrom(request), id).then((data) => ({ data }));
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

  @Get("admin/incidents/archive")
  @RequirePermissions(Permission.IncidentReadActive)
  archive(
    @Req() request: RequestWithUser,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("state") state?: string,
    @Query("trigger") trigger?: string,
    @Query("query") query?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("isTest") isTest?: string,
    @Query("responderId") responderId?: string,
    @Query("operatorId") operatorId?: string,
  ) {
    return this.platform.incidentArchive(actorFrom(request), {
      page: Number(page || 1),
      pageSize: Number(pageSize || 25),
      state,
      trigger,
      query,
      from,
      to,
      isTest: isTest === undefined || isTest === "" ? undefined : isTest === "true",
      responderId,
      operatorId,
    }).then((data) => ({ data }));
  }

  @Get("admin/reports/overview")
  @RequirePermissions(Permission.IncidentReadActive)
  reports(@Req() request: RequestWithUser, @Query("days") days?: string) {
    return this.platform.reportsOverview(actorFrom(request), Number(days || 30)).then((data) => ({ data }));
  }

  @Get("incidents/:id/emergency-profile")
  emergencyProfile(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.platform.incidentEmergencyProfile(actorFrom(request), id).then((data) => ({ data }));
  }

  @Get("incidents/:id/communications")
  communications(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.platform.incidentCommunications(actorFrom(request), id).then((data) => ({ data }));
  }

  @Get("admin/demo")
  @RequirePermissions(Permission.UserManage)
  demoStatus(@Req() request: RequestWithUser) {
    return this.platform.demoStatus(actorFrom(request)).then((data) => ({ data }));
  }

  @Post("admin/demo/reset")
  @HttpCode(200)
  @RequirePermissions(Permission.UserManage)
  demoReset(@Req() request: RequestWithUser) {
    return this.platform.resetDemo(actorFrom(request)).then((data) => ({ data }));
  }

  @Post("admin/demo/advance")
  @HttpCode(200)
  @RequirePermissions(Permission.UserManage)
  demoAdvance(@Req() request: RequestWithUser) {
    return this.platform.advanceDemo(actorFrom(request)).then((data) => ({ data }));
  }

  @Post("admin/integrations/:kind/test")
  @HttpCode(200)
  @RequirePermissions(Permission.UserManage)
  integrationTest(@Param("kind") kind: string, @Req() request: RequestWithUser) {
    return this.platform.integrationTest(actorFrom(request), kind).then((data) => ({ data }));
  }

  @Post("admin/outbox/dead/:id/retry")
  @HttpCode(200)
  @RequirePermissions(Permission.UserManage)
  retryDeadLetter(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.platform.recoverDeadLetter(actorFrom(request), id, "RETRY").then((data) => ({ data }));
  }

  @Post("admin/outbox/dead/:id/resolve")
  @HttpCode(200)
  @RequirePermissions(Permission.UserManage)
  resolveDeadLetter(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.platform.recoverDeadLetter(actorFrom(request), id, "RESOLVE").then((data) => ({ data }));
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

  @Public()
  @Post("rooms/:token/ack")
  @HttpCode(200)
  acknowledgeRoom(@Param("token") token: string) {
    return this.platform.acknowledgeRoom(token).then((data) => ({ data }));
  }

  @Get("guardian/inbox")
  @RequirePermissions(Permission.UserReadSelf)
  guardianInbox(@Req() request: RequestWithUser) {
    return this.platform.guardianInbox(actorFrom(request)).then((data) => ({ data }));
  }

  @Get("responders/me/profile")
  @RequirePermissions(Permission.IncidentReadAssigned)
  responderProfile(@Req() request: RequestWithUser) {
    return this.platform.responderProfile(actorFrom(request)).then((data) => ({ data }));
  }

  @Post("responders/me/profile")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentReadAssigned)
  updateResponderProfile(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.platform.updateResponderProfile(actorFrom(request), parseBody(responderProfileSchema, body)).then((data) => ({ data }));
  }

  @Get("responders")
  @RequirePermissions(Permission.IncidentAcknowledge)
  responders(@Req() request: RequestWithUser) {
    return this.platform.listResponders(actorFrom(request)).then((data) => ({ data }));
  }

  @Post("incidents/:id/claim")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentAcknowledge)
  claim(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.platform
      .claimIncident(actorFrom(request), id, requestContext.getStore()?.requestId ?? null)
      .then((data) => ({ data }));
  }

  @Post("incidents/:id/responder-location")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentRespond)
  responderLocation(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithUser) {
    const input = parseBody(responderLocationSchema, body);
    return this.platform
      .updateResponderLocation(actorFrom(request), id, input.latitude, input.longitude, input.speedMps)
      .then((data) => ({ data }));
  }

  @Post("deliveries/:id/ack")
  @HttpCode(200)
  @RequirePermissions(Permission.UserReadSelf)
  ackDelivery(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.platform.acknowledgeDelivery(actorFrom(request), id).then((data) => ({ data }));
  }

  @Get("operators")
  @RequirePermissions(Permission.IncidentReadActive)
  operators(@Req() request: RequestWithUser) {
    return this.platform.listOperators(actorFrom(request)).then((data) => ({ data }));
  }

  @Post("operators/shifts/start")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentAcknowledge)
  startShift(@Req() request: RequestWithUser) {
    return this.platform.startShift(actorFrom(request)).then((data) => ({ data }));
  }

  @Post("operators/shifts/ready")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentAcknowledge)
  readyShift(@Req() request: RequestWithUser) {
    return this.platform.markShiftReady(actorFrom(request)).then((data) => ({ data }));
  }

  @Post("operators/shifts/handover")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentAcknowledge)
  handover(@Body() body: unknown, @Req() request: RequestWithUser) {
    const input = parseBody(operatorHandoverSchema, body);
    return this.platform.handoverShift(actorFrom(request), input.note, input.handoverToId).then((data) => ({ data }));
  }

  @Get("operators/shifts/current")
  @RequirePermissions(Permission.IncidentAcknowledge)
  currentShift(@Req() request: RequestWithUser) {
    return this.platform.currentShift(actorFrom(request)).then((data) => ({ data }));
  }
}

function actorFrom(request: RequestWithUser): Actor {
  const user = request.user!;
  return { id: user.id, role: user.role, displayName: user.displayName, emergencyDeviceId: request.emergencyDeviceId ?? null };
}
