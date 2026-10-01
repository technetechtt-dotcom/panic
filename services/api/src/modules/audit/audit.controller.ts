import { Controller, Get, Query } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { RequirePermissions } from "../../common/guards";
import { AUDIT_STORE } from "../../common/tokens";
import type { AuditStore } from "../../domain/ports";
import { Permission } from "../../domain/rbac";

@Controller("audit")
export class AuditController {
  constructor(@Inject(AUDIT_STORE) private readonly audit: AuditStore) {}

  @Get()
  @RequirePermissions(Permission.AuditRead)
  async list(@Query("limit") limit: string | undefined) {
    const parsed = Number(limit ?? 50);
    const bounded = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;
    const rows = await this.audit.list(bounded);
    return {
      data: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
