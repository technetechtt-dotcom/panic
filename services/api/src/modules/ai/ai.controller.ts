import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import { aiQuerySchema, aiRecommendationDecisionSchema, aiReviewSchema } from "@guardian/shared-validation";
import { RequirePermissions, type RequestWithUser } from "../../common/guards";
import { parseBody } from "../../common/http";
import { AiService } from "../../domain/ai-service";
import type { Actor } from "../../domain/ports";
import { Permission } from "../../domain/rbac";

@Controller()
export class AiController {
  constructor(@Inject(AiService) private readonly ai: AiService) {}

  @Get("incidents/:id/ai")
  bundle(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.ai.incidentAi(actorFrom(request), id).then((data) => ({ data }));
  }

  @Get("incidents/:id/ai/risk")
  risk(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.ai.risk(actorFrom(request), id).then((data) => ({ data }));
  }

  @Get("incidents/:id/ai/summary")
  summary(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.ai.summary(actorFrom(request), id).then((data) => ({ data }));
  }

  @Get("incidents/:id/ai/evidence")
  evidence(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.ai.evidence(actorFrom(request), id).then((data) => ({ data }));
  }

  @Get("incidents/:id/ai/search")
  search(@Param("id") id: string, @Req() request: RequestWithUser) {
    return this.ai.search(actorFrom(request), id).then((data) => ({ data }));
  }

  @Post("incidents/:id/ai/query")
  @HttpCode(200)
  query(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithUser) {
    const input = parseBody(aiQuerySchema, body);
    return this.ai.query(actorFrom(request), id, input.question).then((data) => ({ data }));
  }

  @Post("incidents/:id/ai/review")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentAcknowledge)
  review(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithUser) {
    const input = parseBody(aiReviewSchema, body);
    return this.ai.review(actorFrom(request), id, input).then((data) => ({ data }));
  }

  @Post("incidents/:id/ai/recommendations/:recommendationId")
  @HttpCode(200)
  @RequirePermissions(Permission.IncidentAcknowledge)
  decide(
    @Param("id") id: string,
    @Param("recommendationId") recommendationId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser,
  ) {
    const input = parseBody(aiRecommendationDecisionSchema, body);
    return this.ai.decideRecommendation(actorFrom(request), id, recommendationId, input.status).then((data) => ({ data }));
  }

  @Get("operators/shifts/brief")
  @RequirePermissions(Permission.IncidentReadActive)
  handover(@Req() request: RequestWithUser) {
    return this.ai.handover(actorFrom(request)).then((data) => ({ data }));
  }
}

function actorFrom(request: RequestWithUser): Actor {
  const user = request.user!;
  return { id: user.id, role: user.role, displayName: user.displayName, emergencyDeviceId: request.emergencyDeviceId ?? null };
}
