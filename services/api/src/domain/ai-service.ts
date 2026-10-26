import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor, Clock, IdGenerator, RealtimePublisher } from "./ports";
import { AppError } from "./errors";
import { haversineMeters } from "./operations";
import { hasPermission, Permission } from "./rbac";
import { apnsHealth, fcmHealth, smsHealth } from "./sms";
import {
  PRODUCTION_MODEL,
  SHADOW_MODEL,
  answerQuestion,
  assessThreat,
  featureSnapshot,
  incidentSummary,
  searchAreas,
  shiftHandoverSummary,
  type AiFacts,
  type ThreatAssessment,
} from "./ai-engine";

export class AiService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly publisher: RealtimePublisher | null = null,
  ) {}

  async incidentAi(actor: Actor, incidentId: string) {
    await this.assertReader(actor, incidentId);
    return this.assess(incidentId, false);
  }

  async risk(actor: Actor, incidentId: string) {
    const bundle = await this.incidentAi(actor, incidentId);
    return { decision: bundle.decision, shadow: bundle.shadow, features: bundle.features };
  }

  async summary(actor: Actor, incidentId: string) {
    const bundle = await this.incidentAi(actor, incidentId);
    return bundle.summary;
  }

  async evidence(actor: Actor, incidentId: string) {
    const bundle = await this.incidentAi(actor, incidentId);
    return bundle.evidence;
  }

  async search(actor: Actor, incidentId: string) {
    const bundle = await this.incidentAi(actor, incidentId);
    return bundle.search;
  }

  async query(actor: Actor, incidentId: string, question: string) {
    await this.assertReader(actor, incidentId);
    const facts = await this.facts(incidentId);
    return answerQuestion(facts, question);
  }

  async review(actor: Actor, incidentId: string, input: { targetType: string; targetId: string; status: string; note: string }) {
    await this.assertReader(actor, incidentId);
    if (!hasPermission(actor.role, Permission.IncidentAcknowledge)) {
      throw new AppError("FORBIDDEN", 403, "You cannot review an AI result.");
    }
    const row = await this.prisma.aiReview.create({
      data: {
        id: this.ids.uuid(),
        incidentId,
        actorId: actor.id,
        targetType: input.targetType,
        targetId: input.targetId,
        status: input.status,
        note: input.note.slice(0, 1000),
        createdAt: this.clock.now(),
      },
    });
    return { id: row.id, status: row.status, note: row.note, createdAt: row.createdAt.toISOString() };
  }

  async decideRecommendation(actor: Actor, incidentId: string, recommendationId: string, status: "ACCEPTED" | "REJECTED") {
    await this.assertReader(actor, incidentId);
    if (!hasPermission(actor.role, Permission.IncidentAcknowledge)) {
      throw new AppError("FORBIDDEN", 403, "You cannot accept or reject a recommendation.");
    }
    const existing = await this.prisma.aiRecommendation.findFirst({ where: { id: recommendationId, incidentId } });
    if (!existing) throw new AppError("NOT_FOUND", 404, "That recommendation was not found.");
    if (existing.status !== "PENDING") throw new AppError("CONFLICT", 409, "That recommendation is no longer pending.");
    const now = this.clock.now();
    const row = await this.prisma.aiRecommendation.update({
      where: { id: recommendationId },
      data: { status, decidedById: actor.id, decidedAt: now },
    });
    return { id: row.id, status: row.status, decidedAt: now.toISOString() };
  }

  async handover(actor: Actor) {
    if (!hasPermission(actor.role, Permission.IncidentReadActive)) {
      throw new AppError("FORBIDDEN", 403, "You cannot build a shift handover.");
    }
    const incidents = await this.prisma.incident.findMany({
      where: { state: { notIn: ["RESOLVED", "ARCHIVED"] } },
      include: { user: { select: { displayName: true } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    const deadLetters = await this.prisma.outboxDeadLetter.count();
    const notes = [
      `SMS ${smsHealth()}.`,
      `FCM ${fcmHealth()}.`,
      `APNs ${apnsHealth()}.`,
    ];
    return {
      summary: shiftHandoverSummary({
        operatorName: actor.displayName,
        incidents: incidents.map((row) => ({
          displayName: row.user.displayName,
          state: row.state,
          triggerType: row.triggerType,
          duress: row.duress,
          isTest: row.isTest,
        })),
        deadLetters,
        providerNotes: notes,
      }),
    };
  }

  async counts() {
    const [decisions, shadow, pending] = await Promise.all([
      this.prisma.aiDecision.count({ where: { mode: "PRODUCTION" } }),
      this.prisma.aiDecision.count({ where: { mode: "SHADOW" } }),
      this.prisma.aiRecommendation.count({ where: { status: "PENDING" } }),
    ]);
    return {
      productionModel: `${PRODUCTION_MODEL.name}@${PRODUCTION_MODEL.version}`,
      shadowModel: `${SHADOW_MODEL.name}@${SHADOW_MODEL.version}`,
      decisions,
      shadow,
      pendingRecommendations: pending,
    };
  }

  async assess(incidentId: string, publish = true) {
    const facts = await this.facts(incidentId);
    const production = assessThreat(facts, "PRODUCTION");
    const shadow = assessThreat(facts, "SHADOW");
    const latest = await this.prisma.aiDecision.findFirst({
      where: { incidentId, mode: "PRODUCTION", modelVersion: PRODUCTION_MODEL.version },
      orderBy: { createdAt: "desc" },
    });
    if (!latest || latest.level !== production.level || latest.explanation !== production.explanation) {
      await this.ensureModels();
      await this.prisma.aiRecommendation.updateMany({
        where: { incidentId, status: "PENDING" },
        data: { status: "SUPERSEDED" },
      });
      const decisionId = await this.storeDecision(incidentId, production, facts);
      await this.storeDecision(incidentId, shadow, facts);
      const summary = incidentSummary(facts, production);
      const now = this.clock.now();
      await this.prisma.aiIncidentSummary.create({
        data: {
          id: this.ids.uuid(),
          incidentId,
          summary: summary.summary,
          changes: summary.changes,
          risks: summary.risks,
          modelVersion: PRODUCTION_MODEL.version,
          createdAt: now,
        },
      });
      await this.prisma.searchPrediction.deleteMany({ where: { incidentId } });
      for (const area of searchAreas(facts)) {
        await this.prisma.searchPrediction.create({
          data: {
            id: this.ids.uuid(),
            incidentId,
            kind: area.kind,
            label: area.label,
            confidence: area.confidence,
            geometry: area.polygon as Prisma.InputJsonValue,
            createdAt: now,
          },
        });
      }
      if (latest?.id) {
        await this.prisma.aiRecommendation.updateMany({
          where: { decisionId: latest.id, status: "PENDING" },
          data: { status: "SUPERSEDED" },
        });
      }
      for (const item of production.recommendations) {
        await this.prisma.aiRecommendation.create({
          data: {
            id: this.ids.uuid(),
            incidentId,
            decisionId,
            action: item.action,
            reason: item.reason,
            status: "PENDING",
            createdAt: now,
          },
        });
      }
      if (publish) this.publisher?.publish("ai.risk.updated", { incidentId, level: production.level });
    }
    return this.bundle(incidentId, facts, production, shadow);
  }

  private async bundle(incidentId: string, facts: AiFacts, production: ThreatAssessment, shadow: ThreatAssessment) {
    const [recommendations, search, reviews, summaryRow] = await Promise.all([
      this.prisma.aiRecommendation.findMany({ where: { incidentId, status: { not: "SUPERSEDED" } }, orderBy: { createdAt: "desc" }, take: 12 }),
      this.prisma.searchPrediction.findMany({ where: { incidentId }, orderBy: { createdAt: "desc" }, take: 6 }),
      this.prisma.aiReview.findMany({ where: { incidentId }, orderBy: { createdAt: "desc" }, take: 12 }),
      this.prisma.aiIncidentSummary.findFirst({ where: { incidentId }, orderBy: { createdAt: "desc" } }),
    ]);
    const summary = summaryRow
      ? { summary: summaryRow.summary, changes: summaryRow.changes, risks: summaryRow.risks }
      : incidentSummary(facts, production);
    return {
      safety: "An explicit SOS is stored before this assessment runs. The score cannot delay, lower, or cancel it.",
      decision: {
        level: production.level,
        confidence: production.confidence,
        explanation: production.explanation,
        contributing: production.contributing,
        contradicting: production.contradicting,
        modelName: production.modelName,
        modelVersion: production.modelVersion,
      },
      shadow: {
        level: shadow.level,
        confidence: shadow.confidence,
        modelVersion: shadow.modelVersion,
        applied: false,
        note: "Shadow output is stored for comparison. It is not the published level.",
      },
      summary,
      recommendations: recommendations.map((row) => ({
        id: row.id,
        action: row.action,
        reason: row.reason,
        status: row.status,
      })),
      search: search.map((row) => ({
        id: row.id,
        kind: row.kind,
        label: row.label,
        confidence: row.confidence,
        polygon: row.geometry,
      })),
      evidence: {
        analysed: false,
        chunks: facts.evidenceCount,
        note: "No speech, OCR, or vision model is deployed. Original evidence bytes are unchanged.",
      },
      features: featureSnapshot(facts),
      reviews: reviews.map((row) => ({
        id: row.id,
        targetType: row.targetType,
        status: row.status,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  private async storeDecision(incidentId: string, assessment: ThreatAssessment, facts: AiFacts): Promise<string> {
    const id = this.ids.uuid();
    await this.prisma.aiDecision.create({
      data: {
        id,
        incidentId,
        modelName: assessment.modelName,
        modelVersion: assessment.modelVersion,
        mode: assessment.mode,
        level: assessment.level,
        confidence: assessment.confidence,
        explanation: assessment.explanation,
        contributing: assessment.contributing as unknown as Prisma.InputJsonValue,
        contradicting: assessment.contradicting as unknown as Prisma.InputJsonValue,
        featureSnapshot: featureSnapshot(facts) as Prisma.InputJsonValue,
        createdAt: this.clock.now(),
      },
    });
    return id;
  }

  private async ensureModels(): Promise<void> {
    for (const model of [PRODUCTION_MODEL, SHADOW_MODEL]) {
      await this.prisma.aiModel.upsert({
        where: { name_version: { name: model.name, version: model.version } },
        update: { purpose: model.purpose, status: model.status, datasetNote: model.datasetNote },
        create: {
          id: this.ids.uuid(),
          name: model.name,
          version: model.version,
          purpose: model.purpose,
          status: model.status,
          datasetNote: model.datasetNote,
        },
      });
    }
  }

  private async facts(incidentId: string): Promise<AiFacts> {
    const incident = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        user: { select: { displayName: true } },
        timeline: { orderBy: { occurredAt: "asc" }, select: { message: true } },
        assignments: { include: { responder: { select: { displayName: true } } } },
      },
    });
    if (!incident) throw new AppError("NOT_FOUND", 404, "That incident was not found.");
    const [locationCount, evidenceCount, guardianTotal, guardianAcked] = await Promise.all([
      this.prisma.incidentLocation.count({ where: { incidentId } }),
      this.prisma.evidenceChunk.count({ where: { incidentId } }),
      this.prisma.trustedContact.count({ where: { userId: incident.userId, active: true } }),
      this.prisma.notificationDelivery.count({ where: { incidentId, acknowledgedAt: { not: null } } }),
    ]);
    return {
      displayName: incident.user.displayName,
      triggerType: incident.triggerType,
      state: incident.state,
      duress: incident.duress,
      isTest: incident.isTest,
      contactStatus: incident.contactStatus,
      protectionMode: incident.protectionMode,
      lastLatitude: incident.lastLatitude,
      lastLongitude: incident.lastLongitude,
      lastHeading: incident.lastHeading,
      lastSpeed: incident.lastSpeed,
      lastAccuracy: incident.lastAccuracy,
      lastBattery: incident.lastBattery,
      lastHeartbeatAt: incident.lastHeartbeatAt?.toISOString() ?? null,
      contactLostAt: incident.contactLostAt?.toISOString() ?? null,
      acknowledgedAt: incident.acknowledgedAt?.toISOString() ?? null,
      locationCount,
      evidenceCount,
      guardianTotal,
      guardianAcked,
      responders: incident.assignments.map((row) => ({
        name: row.responder.displayName,
        status: row.status,
        distanceMeters:
          incident.lastLatitude != null && incident.lastLongitude != null && row.lastLatitude != null && row.lastLongitude != null
            ? haversineMeters(incident.lastLatitude, incident.lastLongitude, row.lastLatitude, row.lastLongitude)
            : null,
      })),
      timeline: incident.timeline.map((entry) => entry.message),
      nowMs: this.clock.now().getTime(),
    };
  }

  private async assertReader(actor: Actor, incidentId: string): Promise<void> {
    if (hasPermission(actor.role, Permission.IncidentReadActive)) return;
    if (!hasPermission(actor.role, Permission.IncidentReadAssigned)) {
      throw new AppError("FORBIDDEN", 403, "You cannot view this intelligence.");
    }
    const assigned = await this.prisma.responderAssignment.findFirst({
      where: { incidentId, responderId: actor.id, status: { not: "DECLINED" } },
    });
    if (!assigned) throw new AppError("FORBIDDEN", 403, "You can view intelligence only for an incident assigned to you.");
  }
}
