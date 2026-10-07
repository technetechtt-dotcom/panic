import { importPKCS8, SignJWT } from "jose";

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

export type ProviderHealth = "NOT_CONFIGURED" | "CONFIGURED" | "HEALTHY" | "DEGRADED" | "FAILED" | "NOT_IMPLEMENTED";

export function smsHealth(env: NodeJS.ProcessEnv = process.env): ProviderHealth {
  return env.TWILIO_ACCOUNT_SID?.trim() && env.TWILIO_AUTH_TOKEN?.trim() && env.TWILIO_FROM?.trim()
    ? "CONFIGURED"
    : "NOT_CONFIGURED";
}

export function fcmHealth(env: NodeJS.ProcessEnv = process.env): ProviderHealth {
  if (fcmV1Ready(env)) return "CONFIGURED";
  if (env.FCM_SERVER_KEY?.trim()) return "DEGRADED";
  return "NOT_CONFIGURED";
}

export function apnsHealth(env: NodeJS.ProcessEnv = process.env): ProviderHealth {
  if (apnsReady(env)) return "CONFIGURED";
  if (env.APNS_KEY_ID?.trim() && env.APNS_TEAM_ID?.trim()) return "NOT_IMPLEMENTED";
  return "NOT_CONFIGURED";
}

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

function fcmV1Ready(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.FCM_PROJECT_ID?.trim() && env.FCM_CLIENT_EMAIL?.trim() && env.FCM_PRIVATE_KEY?.trim());
}

function apnsReady(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.APNS_KEY_ID?.trim() && env.APNS_TEAM_ID?.trim() && env.APNS_KEY_P8?.trim());
}

export async function sendApns(token: string, title: string, body: string, env: NodeJS.ProcessEnv = process.env): Promise<SmsSendResult> {
  if (!token) return { delivered: false, simulated: true, reason: "No Apple device token was stored." };
  if (!apnsReady(env)) {
    if (env.APNS_KEY_ID?.trim() && env.APNS_TEAM_ID?.trim()) {
      return {
        delivered: false,
        simulated: false,
        reason: "APNs is not implemented without APNS_KEY_P8. No Apple push was sent.",
      };
    }
    return { delivered: false, simulated: true, reason: "APNs is not configured, so no Apple push was sent." };
  }
  try {
    const key = await importPKCS8(env.APNS_KEY_P8!.trim().replace(/\\n/g, "\n"), "ES256");
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: env.APNS_KEY_ID!.trim() })
      .setIssuer(env.APNS_TEAM_ID!.trim())
      .setIssuedAt()
      .sign(key);
    const host = env.APNS_PRODUCTION === "true" ? "api.push.apple.com" : "api.sandbox.push.apple.com";
    const topic = env.APNS_BUNDLE_ID?.trim() || "za.co.guardian.app";
    const response = await fetch(`https://${host}/3/device/${token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      },
      body: JSON.stringify({ aps: { alert: { title, body }, sound: "default" } }),
    }).catch(() => null);
    if (!response?.ok) return { delivered: false, simulated: false, reason: "APNs rejected the push." };
    return { delivered: true, simulated: false, reason: "Apple push sent." };
  } catch (error) {
    return { delivered: false, simulated: false, reason: error instanceof Error ? error.message : "APNs signing failed." };
  }
}

export async function sendFcm(token: string, title: string, body: string, env: NodeJS.ProcessEnv = process.env): Promise<SmsSendResult> {
  if (!token) return { delivered: false, simulated: true, reason: "No FCM token was stored." };
  if (!fcmV1Ready(env)) {
    if (env.FCM_SERVER_KEY?.trim()) {
      return {
        delivered: false,
        simulated: false,
        reason: "Legacy FCM server keys are ignored. Set FCM_PROJECT_ID, FCM_CLIENT_EMAIL, and FCM_PRIVATE_KEY.",
      };
    }
    return { delivered: false, simulated: true, reason: "Push is not configured, so no notification was sent." };
  }
  try {
    const access = await googleAccessToken(env);
    if (!access) return { delivered: false, simulated: false, reason: "FCM OAuth token could not be minted." };
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID!.trim()}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          android: { priority: "HIGH" },
        },
      }),
    }).catch(() => null);
    if (!response?.ok) return { delivered: false, simulated: false, reason: "FCM rejected the push." };
    return { delivered: true, simulated: false, reason: "Push sent." };
  } catch (error) {
    return { delivered: false, simulated: false, reason: error instanceof Error ? error.message : "FCM signing failed." };
  }
}

async function googleAccessToken(env: NodeJS.ProcessEnv): Promise<string | null> {
  const email = env.FCM_CLIENT_EMAIL!.trim();
  const pem = env.FCM_PRIVATE_KEY!.trim().replace(/\\n/g, "\n");
  const key = await importPKCS8(pem, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(email)
    .setSubject(email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = (await response.json()) as { access_token?: string };
  return payload.access_token ?? null;
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
