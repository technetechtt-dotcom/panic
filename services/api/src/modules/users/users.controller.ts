import { Controller, Get, Req } from "@nestjs/common";
import { RequirePermissions, type RequestWithUser } from "../../common/guards";
import { Permission } from "../../domain/rbac";

@Controller("users")
export class UsersController {
  @Get("me")
  @RequirePermissions(Permission.UserReadSelf)
  me(@Req() request: RequestWithUser) {
    const user = request.user!;
    return {
      data: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
    };
  }
}
