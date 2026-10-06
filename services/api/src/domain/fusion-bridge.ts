export class FusionBridge {
  handler: (userId: string, triggerType: "JOURNEY_TIMEOUT" | "SYSTEM_RISK_ESCALATION") => Promise<void> = async () => undefined;

  raise(userId: string, triggerType: "JOURNEY_TIMEOUT" | "SYSTEM_RISK_ESCALATION"): Promise<void> {
    return this.handler(userId, triggerType);
  }
}
