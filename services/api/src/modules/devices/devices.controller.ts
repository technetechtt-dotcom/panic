import { Body, Controller, Get, Inject, Post, Req } from "@nestjs/common";
import { deviceRegistrationSchema } from "@guardian/shared-validation";
import { RequirePermissions, type RequestWithUser } from "../../common/guards";
import { requestContext, parseBody } from "../../common/http";
import { DeviceService } from "../../domain/device-service";
import { Permission } from "../../domain/rbac";
import type { Actor } from "../../domain/ports";

@Controller("devices")
export class DevicesController {
  constructor(@Inject(DeviceService) private readonly devices: DeviceService) {}

  @Post()
  @RequirePermissions(Permission.DeviceRegisterOwn)
  async register(@Body() body: unknown, @Req() request: RequestWithUser) {
    const device = await this.devices.register(
      actorFrom(request),
      parseBody(deviceRegistrationSchema, body),
      requestContext.getStore()?.requestId ?? null,
    );
    return { data: device };
  }

  @Get()
  @RequirePermissions(Permission.DeviceRegisterOwn)
  async list(@Req() request: RequestWithUser) {
    return { data: await this.devices.list(actorFrom(request)) };
  }
}

function actorFrom(request: RequestWithUser): Actor {
  const user = request.user!;
  return { id: user.id, role: user.role, displayName: user.displayName };
}
