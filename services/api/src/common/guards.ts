import { CanActivate, ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { emergencyRouteAllowed } from "../domain/emergency-route";
import { sha256 } from "../domain/security";
import { AppError } from "../domain/errors";
import type { UserRecord } from "../domain/ports";
import { hasPermission, type PermissionName } from "../domain/rbac";
import type { AccessTokenIssuer } from "../domain/auth-service";
import type { UserStore } from "../domain/ports";
import type { DeviceStore } from "../domain/ports";
import { ACCESS_TOKENS, DEVICE_STORE, USER_STORE } from "./tokens";
import { Inject } from "@nestjs/common";

export const PERMISSIONS_KEY = "permissions";
export const IS_PUBLIC = "isPublic";
export const RequirePermissions = (...permissions: PermissionName[]) => SetMetadata(PERMISSIONS_KEY, permissions);
export const Public = () => SetMetadata(IS_PUBLIC, true);

export type RequestWithUser = Request & { user?: UserRecord; requestId?: string; emergencyOnly?: boolean };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKENS) private readonly tokens: AccessTokenIssuer,
    @Inject(USER_STORE) private readonly users: UserStore,
    @Inject(DEVICE_STORE) private readonly devices: DeviceStore,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.header("authorization") ?? "";
    if (header.startsWith("Emergency ")) {
      const userId = await this.devices.findUserIdByEmergencyHash(sha256(header.slice("Emergency ".length).trim()));
      if (!userId) throw new AppError("UNAUTHENTICATED", 401, "Sign in required.");
      const user = await this.users.findById(userId);
      if (!user) throw new AppError("UNAUTHENTICATED", 401, "Sign in required.");
      request.user = user;
      request.emergencyOnly = true;
      return true;
    }
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new AppError("UNAUTHENTICATED", 401, "Sign in required.");
    let userId: string;
    try {
      const claims = await this.tokens.verify(token);
      userId = claims.sub;
    } catch {
      throw new AppError("UNAUTHENTICATED", 401, "Sign in required.");
    }
    const user = await this.users.findById(userId);
    if (!user) throw new AppError("UNAUTHENTICATED", 401, "Sign in required.");
    request.user = user;
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;
    const required = this.reflector.getAllAndOverride<PermissionName[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (request.emergencyOnly && !emergencyRouteAllowed(request.method, request.path)) {
      throw new AppError("FORBIDDEN", 403, "This phone credential can only send SOS, location, heartbeat, and evidence.");
    }
    const user = request.user;
    if (!user) throw new AppError("UNAUTHENTICATED", 401, "Sign in required.");
    if (!required.every((permission) => hasPermission(user.role, permission))) {
      throw new AppError("FORBIDDEN", 403, "You do not have access to this action.");
    }
    return true;
  }
}
