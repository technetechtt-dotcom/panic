import { Controller, Get, Query } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { Inject } from "@nestjs/common";
import { RequirePermissions } from "../../common/guards";
import { AUDIT_STORE } from "../../common/tokens";
import type { AuditStore } from "../../domain/ports";
import { Permission } from "../../domain/rbac";
import { PrismaService } from "../../infra/prisma.service";

@Controller("audit")
export class AuditController {
  constructor(
    @Inject(AUDIT_STORE) private readonly audit: AuditStore,
    private readonly prisma: PrismaService,
  ) {}

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

  @Get("search")
  @RequirePermissions(Permission.AuditRead)
  async search(
    @Query("page") pageRaw?: string,
    @Query("pageSize") pageSizeRaw?: string,
    @Query("query") query?: string,
    @Query("action") action?: string,
    @Query("actorId") actorId?: string,
    @Query("entityType") entityType?: string,
    @Query("entityId") entityId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const page = Math.max(1, Number(pageRaw || 1) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(pageSizeRaw || 50) || 50));
    const where: Prisma.AuditEventWhereInput = {};
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = { contains: entityId, mode: "insensitive" };
    if (actorId && /^[0-9a-f-]{36}$/i.test(actorId)) where.actorId = actorId;
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }
    const needle = query?.trim();
    if (needle) {
      where.OR = [
        { action: { contains: needle, mode: "insensitive" } },
        { entityType: { contains: needle, mode: "insensitive" } },
        { entityId: { contains: needle, mode: "insensitive" } },
        { correlationId: { contains: needle, mode: "insensitive" } },
        { requestId: { contains: needle, mode: "insensitive" } },
        { actor: { displayName: { contains: needle, mode: "insensitive" } } },
        { actor: { email: { contains: needle, mode: "insensitive" } } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        include: { actor: { select: { displayName: true, email: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      data: {
        page,
        pageSize,
        total,
        pages: Math.max(1, Math.ceil(total / pageSize)),
        items: rows.map((row) => ({
          id: row.id,
          actorId: row.actorId,
          actorName: row.actor?.displayName ?? null,
          actorEmail: row.actor?.email ?? null,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          correlationId: row.correlationId,
          requestId: row.requestId,
          metadata: row.metadata,
          createdAt: row.createdAt.toISOString(),
        })),
      },
    };
  }

}
