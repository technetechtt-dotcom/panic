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

export class TwilioSmsProvider implements EmergencySmsProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async send(message: EmergencySmsMessage): Promise<SmsSendResult> {
    const sid = this.env.TWILIO_ACCOUNT_SID?.trim();
    const token = this.env.TWILIO_AUTH_TOKEN?.trim();
    const from = this.env.TWILIO_FROM?.trim();
    if (!sid || !token || !from || !message.to) {
      return { delivered: false, simulated: true, reason: "SMS is not configured, so this message was not transmitted." };
    }
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: message.to, From: from, Body: message.body }),
    }).catch(() => null);
    if (!response?.ok) return { delivered: false, simulated: false, reason: "The SMS provider rejected the message." };
    return { delivered: true, simulated: false, reason: "SMS sent." };
  }
}

export async function sendApns(token: string, title: string, body: string, env: NodeJS.ProcessEnv = process.env): Promise<SmsSendResult> {
  const key = env.APNS_KEY_ID?.trim();
  const team = env.APNS_TEAM_ID?.trim();
  if (!key || !team || !token) {
    return { delivered: false, simulated: true, reason: "APNs is not configured, so no Apple push was sent." };
  }
  void title;
  void body;
  return {
    delivered: false,
    simulated: false,
    reason: "APNs key ids are present, but this process does not sign an Apple push. No notification was sent.",
  };
}

export async function sendFcm(token: string, title: string, body: string, env: NodeJS.ProcessEnv = process.env): Promise<SmsSendResult> {
  const key = env.FCM_SERVER_KEY?.trim();
  if (!key || !token) return { delivered: false, simulated: true, reason: "Push is not configured, so no notification was sent." };
  const response = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: { Authorization: `key=${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: token, notification: { title, body } }),
  }).catch(() => null);
  if (!response?.ok) return { delivered: false, simulated: false, reason: "FCM rejected the push." };
  return { delivered: true, simulated: false, reason: "Push sent." };
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
