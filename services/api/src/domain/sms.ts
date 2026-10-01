export interface EmergencySmsMessage {
  to: string;
  body: string;
  incidentId: string;
}

export interface SmsSendResult {
  delivered: boolean;
  simulated: boolean;
  reason: string;
}

/**
 * SMS fallback boundary. The simulator records the message and never transmits it.
 * Incident dispatch does not call this provider.
 */
export interface EmergencySmsProvider {
  send(message: EmergencySmsMessage): Promise<SmsSendResult>;
}

export class SimulatedSmsProvider implements EmergencySmsProvider {
  readonly recorded: EmergencySmsMessage[] = [];

  async send(message: EmergencySmsMessage): Promise<SmsSendResult> {
    this.recorded.push(message);
    return {
      delivered: false,
      simulated: true,
      reason: "SMS is not transmitted in this build.",
    };
  }
}
