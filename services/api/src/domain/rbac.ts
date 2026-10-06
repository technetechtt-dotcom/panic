import type { Role } from "@guardian/shared-types";

export const Permission = {
  IncidentCreateOwn: "incident:create:own",
  IncidentReadOwn: "incident:read:own",
  IncidentReadActive: "incident:read:active",
  IncidentAcknowledge: "incident:acknowledge",
  IncidentResolve: "incident:resolve",
  DeviceRegisterOwn: "device:register:own",
  ProtectionManageOwn: "protection:manage:own",
  AuditRead: "audit:read",
  UserReadSelf: "user:read:self",
  IncidentReadAssigned: "incident:read:assigned",
  IncidentRespond: "incident:respond",
  UserManage: "user:manage",
  PlatformRead: "platform:read",
} as const;

export type PermissionName = (typeof Permission)[keyof typeof Permission];

const ALL_PERMISSIONS = Object.values(Permission);

export const ROLE_PERMISSIONS: Record<Role, readonly PermissionName[]> = {
  USER: [
    Permission.IncidentCreateOwn,
    Permission.IncidentReadOwn,
    Permission.DeviceRegisterOwn,
    Permission.ProtectionManageOwn,
    Permission.UserReadSelf,
  ],
  GUARDIAN: [],
  MONITOR_OPERATOR: [
    Permission.IncidentReadActive,
    Permission.IncidentAcknowledge,
    Permission.IncidentResolve,
    Permission.UserReadSelf,
    Permission.PlatformRead,
  ],
  SUPERVISOR: [
    Permission.IncidentReadActive,
    Permission.IncidentAcknowledge,
    Permission.IncidentResolve,
    Permission.AuditRead,
    Permission.UserReadSelf,
    Permission.UserManage,
    Permission.PlatformRead,
  ],
  RESPONDER: [Permission.IncidentReadAssigned, Permission.IncidentRespond, Permission.UserReadSelf],
  ADMIN: ALL_PERMISSIONS,
};

export function hasPermission(role: Role, permission: PermissionName): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function canAssignRole(actor: Role, next: Role, changingSelf: boolean): string | null {
  if (changingSelf) return "You cannot change your own role.";
  if (actor !== "ADMIN" && actor !== "SUPERVISOR") return "You cannot manage accounts.";
  if (next === "ADMIN" && actor !== "ADMIN") return "Only an administrator can assign the administrator role.";
  if (actor === "SUPERVISOR" && (next === "ADMIN" || next === "SUPERVISOR")) {
    return "A supervisor cannot assign an administrator or supervisor role.";
  }
  return null;
}
