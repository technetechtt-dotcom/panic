import type { Role } from "@guardian/shared-types";

export const Permission = {
  IncidentCreateOwn: "incident:create:own",
  IncidentReadOwn: "incident:read:own",
  IncidentReadActive: "incident:read:active",
  IncidentAcknowledge: "incident:acknowledge",
  IncidentResolve: "incident:resolve",
  DeviceRegisterOwn: "device:register:own",
  AuditRead: "audit:read",
  UserReadSelf: "user:read:self",
} as const;

export type PermissionName = (typeof Permission)[keyof typeof Permission];

const ALL_PERMISSIONS = Object.values(Permission);

export const ROLE_PERMISSIONS: Record<Role, readonly PermissionName[]> = {
  USER: [
    Permission.IncidentCreateOwn,
    Permission.IncidentReadOwn,
    Permission.DeviceRegisterOwn,
    Permission.UserReadSelf,
  ],
  GUARDIAN: [],
  MONITOR_OPERATOR: [
    Permission.IncidentReadActive,
    Permission.IncidentAcknowledge,
    Permission.IncidentResolve,
    Permission.UserReadSelf,
  ],
  SUPERVISOR: [
    Permission.IncidentReadActive,
    Permission.IncidentAcknowledge,
    Permission.IncidentResolve,
    Permission.AuditRead,
    Permission.UserReadSelf,
  ],
  RESPONDER: [],
  ADMIN: ALL_PERMISSIONS,
};

export function hasPermission(role: Role, permission: PermissionName): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
