import { searchCorridor } from "./operations";

/** Production scorer. Rules over stored facts. It has no trained weights. */
export const PRODUCTION_MODEL = {
  name: "guardian-threat-rules",
  version: "1.0.0",
  purpose: "Explain a threat level from confirmed incident facts without gating SOS.",
  status: "PRODUCTION" as const,
  datasetNote: "No training set. Outcomes are deterministic rules.",
};

/** Compared and stored. Its level is never the one shown as the incident decision. */
export const SHADOW_MODEL = {
  name: "guardian-threat-rules",
  version: "1.1.0-shadow",
  purpose: "Shadow contact-loss weighting. Not promoted.",
  status: "SHADOW" as const,
  datasetNote: "Shadow only. A difference here does not change the incident.",
};

export type ThreatLevel = "NORMAL" | "CONCERN" | "HIGH_RISK" | "EMERGENCY" | "CRITICAL";
export type RecommendationStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "SUPERSEDED";

const OPEN_SOS = new Set(["SOS", "ACKNOWLEDGED", "RESPONDING", "USER_LOCATED"]);
const DELIBERATE = new Set(["VOLUME_BUTTON", "VOICE_SAFE_WORD", "MANUAL_SOS", "DURESS", "WEARABLE", "FALL_OR_IMPACT"]);
const ALLOWED_ACTIONS = new Set([
  "ACKNOWLEDGE_INCIDENT",
  "KEEP_INCIDENT_OPEN",
  "CHECK_GUARDIAN_DELIVERY",
  "REVIEW_EVIDENCE",
  "REVIEW_RESPONDER_FIT",
]);

export interface AiFacts {
  displayName: string;
  triggerType: string;
  state: string;
  duress: boolean;
  isTest: boolean;
  contactStatus: string;
  protectionMode: string;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastHeading: number | null;
  lastSpeed: number | null;
  lastAccuracy: number | null;
  lastBattery: number | null;
  lastHeartbeatAt: string | null;
  contactLostAt: string | null;
  acknowledgedAt: string | null;
  locationCount: number;
  evidenceCount: number;
  guardianTotal: number;
  guardianAcked: number;
  responders: Array<{ name: string; distanceMeters: number | null; status: string }>;
  timeline: string[];
  nowMs: number;
}

export interface AiSignal {
  code: string;
  detail: string;
}

export interface AiRecommendationDraft {
  action: string;
  reason: string;
}

export interface ThreatAssessment {
  modelName: string;
  modelVersion: string;
  mode: "PRODUCTION" | "SHADOW";
  level: ThreatLevel;
  confidence: number;
  explanation: string;
  contributing: AiSignal[];
  contradicting: AiSignal[];
  recommendations: AiRecommendationDraft[];
}

export function assessThreat(facts: AiFacts, mode: "PRODUCTION" | "SHADOW" = "PRODUCTION"): ThreatAssessment {
  const model = mode === "SHADOW" ? SHADOW_MODEL : PRODUCTION_MODEL;
  const contributing: AiSignal[] = [];
  const contradicting: AiSignal[] = [];

  if (facts.isTest) {
    contributing.push({ code: "TEST_INCIDENT", detail: "This is a practice incident and stays out of live metrics." });
  }
  if (facts.duress) {
    contributing.push({ code: "DURESS", detail: "A duress PIN was used. A quiet phone is not proof the emergency ended." });
  }
  if (DELIBERATE.has(facts.triggerType)) {
    contributing.push({
      code: "EXPLICIT_TRIGGER",
      detail: `${facts.triggerType} is an explicit trigger. It was accepted before this assessment ran.`,
    });
  }
  if (facts.contactStatus === "DEVICE_CONTACT_LOST") {
    contributing.push({ code: "CONTACT_LOST", detail: "The device stopped checking in. That is a signal, not a location." });
  }
  if (facts.lastBattery != null && lowBattery(facts.lastBattery)) {
    contributing.push({ code: "LOW_BATTERY", detail: "The last battery report was under 15 percent." });
  }
  if (facts.guardianTotal > 0 && facts.guardianAcked === 0) {
    contributing.push({ code: "GUARDIAN_UNACKED", detail: "No trusted contact has acknowledged this incident." });
  }
  if (facts.locationCount === 0 || facts.lastLatitude == null) {
    contributing.push({ code: "NO_CONFIRMED_FIX", detail: "There is no confirmed latitude and longitude yet." });
  } else {
    contradicting.push({ code: "CONFIRMED_FIX", detail: "A device report includes a confirmed position." });
  }
  if (freshHeartbeat(facts)) {
    contradicting.push({ code: "HEARTBEAT_FRESH", detail: "A recent heartbeat shows the device process is still checking in." });
  }

  const level = publishedLevel(facts, mode);
  const confidence = facts.duress || DELIBERATE.has(facts.triggerType) ? 0.99 : confidenceFromFacts(facts);
  const explanation = [
    `${model.name} ${model.version} (${mode}) rates this ${level}.`,
    facts.duress || OPEN_SOS.has(facts.state)
      ? "The open emergency was not delayed, lowered, or cancelled by this score."
      : "This score is advisory. It did not create or close an incident.",
    contributing.map((signal) => signal.detail).join(" "),
    contradicting.length ? `Signals that argue against a worse reading: ${contradicting.map((signal) => signal.detail).join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    modelName: model.name,
    modelVersion: model.version,
    mode,
    level,
    confidence,
    explanation,
    contributing,
    contradicting,
    recommendations: govern(recommend(facts, level)),
  };
}

export function featureSnapshot(facts: AiFacts): Record<string, number | string | null> {
  const heartbeatAge = facts.lastHeartbeatAt ? Math.max(0, Math.round((facts.nowMs - Date.parse(facts.lastHeartbeatAt)) / 1000)) : null;
  return {
    speed: facts.lastSpeed,
    heading: facts.lastHeading,
    heartbeatAgeSeconds: heartbeatAge,
    battery: facts.lastBattery,
    locationCount: facts.locationCount,
    guardianAcknowledgementCount: facts.guardianAcked,
    evidenceCount: facts.evidenceCount,
    responderCount: facts.responders.length,
    closestResponderMeters: facts.responders.reduce<number | null>((best, row) => {
      if (row.distanceMeters == null) return best;
      return best == null ? row.distanceMeters : Math.min(best, row.distanceMeters);
    }, null),
    contactStatus: facts.contactStatus,
    triggerType: facts.triggerType,
  };
}

export function incidentSummary(facts: AiFacts, assessment: ThreatAssessment): { summary: string; changes: string; risks: string } {
  const closest = closestResponder(facts);
  const summary = [
    `${facts.displayName} is ${facts.state} after ${facts.triggerType}.`,
    assessment.explanation,
    facts.isTest ? "Practice incident." : "Live incident.",
  ].join(" ");
  const changes = facts.timeline.slice(-3).join(" ") || "No timeline text is stored yet.";
  const risks = [
    facts.duress ? "Duress is active." : "Duress has not been flagged.",
    facts.contactStatus === "DEVICE_CONTACT_LOST" ? "Contact is lost." : "Contact is still marked online.",
    closest ? `Closest recorded responder is ${closest.name}${closest.distanceMeters == null ? "" : ` at about ${Math.round(closest.distanceMeters)} m`}.` : "No responder distance is stored.",
    facts.evidenceCount ? `${facts.evidenceCount} evidence chunk(s) are stored. They have not been interpreted by a vision or speech model.` : "No evidence chunk is stored.",
  ].join(" ");
  return { summary, changes, risks };
}

export function answerQuestion(facts: AiFacts, question: string): { answer: string; sources: string[] } {
  const asked = question.toLowerCase();
  const sources = ["incident", "timeline"];
  if (asked.includes("before")) {
    return {
      answer: facts.timeline.slice(0, 3).join(" ") || "No timeline entries are stored from before this view.",
      sources,
    };
  }
  if (asked.includes("five minute") || asked.includes("changed")) {
    return { answer: facts.timeline.slice(-5).join(" ") || "No recent timeline entries are stored.", sources };
  }
  if (asked.includes("location") || asked.includes("where")) {
    if (facts.lastLatitude == null || facts.lastLongitude == null) {
      return { answer: "No confirmed location is stored. A missing fix is not a predicted position.", sources: ["incident"] };
    }
    return {
      answer: `Last confirmed device report: ${facts.lastLatitude.toFixed(5)}, ${facts.lastLongitude.toFixed(5)}. Heading ${facts.lastHeading ?? "unknown"}. This is a device report, not a prediction.`,
      sources: ["incident", "locations"],
    };
  }
  if (asked.includes("guardian") || asked.includes("acknowled")) {
    return {
      answer: `${facts.guardianAcked} of ${facts.guardianTotal} trusted contacts have an acknowledgement timestamp.`,
      sources: ["deliveries"],
    };
  }
  if (asked.includes("evidence")) {
    return {
      answer: facts.evidenceCount
        ? `${facts.evidenceCount} original chunk(s) are stored. No speech, OCR, or object model has labelled them.`
        : "No evidence chunk has been stored for this incident.",
      sources: ["evidence"],
    };
  }
  if (asked.includes("responder") || asked.includes("closest")) {
    const closest = closestResponder(facts);
    if (!closest) return { answer: "No responder assignment with a distance is stored. Dispatch remains an operator action.", sources: ["responders"] };
    return {
      answer: `${closest.name} is the closest stored responder${closest.distanceMeters == null ? "" : `, about ${Math.round(closest.distanceMeters)} m away`}, status ${closest.status}. This is a ranking hint, not a dispatch.`,
      sources: ["responders"],
    };
  }
  if (asked.includes("moved") || asked.includes("deviation") || asked.includes("route")) {
    return {
      answer: facts.locationCount > 1
        ? `${facts.locationCount} confirmed points are stored. The search shapes separate confirmed, estimated, and predicted areas.`
        : "There are not enough confirmed points to describe movement.",
      sources: ["locations"],
    };
  }
  if (asked.includes("emergency service") || asked.includes("handover") || asked.includes("summar")) {
    const summary = incidentSummary(facts, assessThreat(facts));
    return { answer: `${summary.summary} ${summary.risks}`, sources };
  }
  return {
    answer: "This assistant answers only from stored incident facts: what happened, the last confirmed location, guardian acknowledgements, evidence count, and responder distance. It cannot cancel an SOS or dispatch anyone.",
    sources,
  };
}

export interface SearchArea {
  kind: "CONFIRMED_AREA" | "ESTIMATED_AREA" | "PREDICTED_AREA";
  label: string;
  confidence: number;
  polygon: Array<{ latitude: number; longitude: number }>;
}

export function searchAreas(facts: AiFacts): SearchArea[] {
  if (facts.lastLatitude == null || facts.lastLongitude == null) return [];
  const confirmedRadius = Math.min(250, Math.max(30, facts.lastAccuracy ?? 50));
  const areas: SearchArea[] = [
    {
      kind: "CONFIRMED_AREA",
      label: "Circle around the last device report. This is the confirmed fix, not a forecast.",
      confidence: 0.9,
      polygon: circle(facts.lastLatitude, facts.lastLongitude, confirmedRadius),
    },
  ];
  const estimated = searchCorridor([{ latitude: facts.lastLatitude, longitude: facts.lastLongitude, heading: facts.lastHeading }]);
  if (estimated) {
    areas.push({
      kind: "ESTIMATED_AREA",
      label: "Heading-based search hint. It is an estimate for people, not a claim about where the person is.",
      confidence: facts.lastHeading == null ? 0.35 : 0.55,
      polygon: estimated.polygon,
    });
  }
  const speed = facts.lastSpeed ?? 0;
  const predictedMeters = Math.min(5000, Math.max(400, speed * 300));
  areas.push({
    kind: "PREDICTED_AREA",
    label: "Wider ring from last speed. Predicted only. Do not treat it as a confirmed location.",
    confidence: 0.2,
    polygon: circle(facts.lastLatitude, facts.lastLongitude, predictedMeters),
  });
  return areas;
}

export function shiftHandoverSummary(input: {
  operatorName: string;
  incidents: Array<{ displayName: string; state: string; triggerType: string; duress: boolean; isTest: boolean }>;
  deadLetters: number;
  providerNotes: string[];
}): string {
  const live = input.incidents.filter((row) => !row.isTest && !["RESOLVED", "ARCHIVED"].includes(row.state));
  const lines = [
    `Handover for ${input.operatorName}.`,
    live.length ? `${live.length} open live incident(s).` : "No open live incidents.",
    ...live.map((row) => `${row.displayName}: ${row.state} via ${row.triggerType}${row.duress ? " (duress)" : ""}.`),
    input.deadLetters ? `${input.deadLetters} notification dead letter(s) need inspection.` : "No notification dead letters.",
    ...input.providerNotes,
    "This summary restates stored records. It does not close incidents.",
  ];
  return lines.join(" ");
}

export function govern(recommendations: AiRecommendationDraft[]): AiRecommendationDraft[] {
  return recommendations.filter((item) => ALLOWED_ACTIONS.has(item.action));
}

function publishedLevel(facts: AiFacts, mode: "PRODUCTION" | "SHADOW"): ThreatLevel {
  if (facts.duress) return "CRITICAL";
  if (OPEN_SOS.has(facts.state) || DELIBERATE.has(facts.triggerType)) return "EMERGENCY";
  let score = 0;
  if (facts.contactStatus === "DEVICE_CONTACT_LOST") score += mode === "SHADOW" ? 40 : 20;
  if (facts.state === "HIGH_RISK") score += 40;
  if (facts.state === "CONCERN") score += 15;
  if (facts.lastBattery != null && lowBattery(facts.lastBattery)) score += 10;
  if (facts.guardianTotal > 0 && facts.guardianAcked === 0) score += 10;
  if (score >= 40) return "HIGH_RISK";
  if (score >= 10) return "CONCERN";
  return "NORMAL";
}

function confidenceFromFacts(facts: AiFacts): number {
  let score = 0.35;
  if (facts.lastLatitude != null) score += 0.15;
  if (freshHeartbeat(facts)) score += 0.15;
  if (facts.evidenceCount > 0) score += 0.1;
  return Math.min(0.85, score);
}

function lowBattery(value: number): boolean {
  return value <= 1 ? value < 0.15 : value < 15;
}

function freshHeartbeat(facts: AiFacts): boolean {
  if (!facts.lastHeartbeatAt) return false;
  return facts.nowMs - Date.parse(facts.lastHeartbeatAt) < 120_000;
}

function recommend(facts: AiFacts, level: ThreatLevel): AiRecommendationDraft[] {
  const items: AiRecommendationDraft[] = [];
  if (OPEN_SOS.has(facts.state) && !facts.acknowledgedAt) {
    items.push({ action: "ACKNOWLEDGE_INCIDENT", reason: "An operator has not acknowledged this open incident." });
  }
  if (facts.duress || facts.contactStatus === "DEVICE_CONTACT_LOST") {
    items.push({ action: "KEEP_INCIDENT_OPEN", reason: "Duress or contact loss must stay visible until a person resolves it." });
  }
  if (facts.guardianTotal > 0 && facts.guardianAcked === 0) {
    items.push({ action: "CHECK_GUARDIAN_DELIVERY", reason: "Move to the next approved contact only after the current delivery is checked." });
  }
  if (facts.evidenceCount > 0) {
    items.push({ action: "REVIEW_EVIDENCE", reason: "Original evidence is stored. A person should review it. No model has labelled it." });
  }
  if (level === "EMERGENCY" || level === "CRITICAL") {
    items.push({
      action: "REVIEW_RESPONDER_FIT",
      reason: "Distance is only one input. Availability, shift, and capability stay with the operator who dispatches.",
    });
  }
  return items;
}

function closestResponder(facts: AiFacts): AiFacts["responders"][number] | null {
  const ranked = facts.responders.filter((row) => row.distanceMeters != null).sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
  return ranked[0] ?? facts.responders[0] ?? null;
}

function circle(lat: number, lng: number, meters: number): Array<{ latitude: number; longitude: number }> {
  const radius = 6_371_000;
  const angular = meters / radius;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  return Array.from({ length: 8 }, (_, index) => {
    const bearing = (index * Math.PI) / 4;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    return { latitude: (lat2 * 180) / Math.PI, longitude: (((lng2 * 180) / Math.PI + 540) % 360) - 180 };
  });
}
