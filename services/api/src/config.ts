export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  redisUrl: string | null;
  jwtSecret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  corsOrigins: string[];
  staleAfterSeconds: number;
  trustProxy: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const jwtSecret = env.JWT_ACCESS_SECRET ?? "";
  if (jwtSecret.length < 32) {
    throw new Error("JWT_ACCESS_SECRET must be at least 32 characters.");
  }
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  if ((env.NODE_ENV ?? "development") === "production") {
    if (!env.EVIDENCE_VAULT_KEY?.trim() || env.EVIDENCE_VAULT_KEY.trim().length < 32) {
      throw new Error("Production requires EVIDENCE_VAULT_KEY of at least 32 characters.");
    }
    if (!env.CORS_ORIGIN?.trim()) {
      throw new Error("Production requires CORS_ORIGIN.");
    }
    const publicUrl = env.PUBLIC_API_URL?.trim() ?? "";
    if (!publicUrl.startsWith("https://")) {
      throw new Error("Production requires PUBLIC_API_URL to be an https URL.");
    }
    const fcmBits = [env.FCM_PROJECT_ID, env.FCM_CLIENT_EMAIL, env.FCM_PRIVATE_KEY].filter((value) => value?.trim());
    if (fcmBits.length > 0 && fcmBits.length < 3) {
      throw new Error("Production FCM is incomplete. Set FCM_PROJECT_ID, FCM_CLIENT_EMAIL, and FCM_PRIVATE_KEY together.");
    }
    const apnsBits = [env.APNS_KEY_ID, env.APNS_TEAM_ID, env.APNS_KEY_P8].filter((value) => value?.trim());
    if (apnsBits.length > 0 && apnsBits.length < 3) {
      throw new Error("Production APNs is incomplete. Set APNS_KEY_ID, APNS_TEAM_ID, and APNS_KEY_P8 together.");
    }
    const twilioBits = [env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM].filter((value) => value?.trim());
    if (twilioBits.length > 0 && twilioBits.length < 3) {
      throw new Error("Production Twilio is incomplete. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM together.");
    }
  }
  const redisUrl = env.REDIS_URL?.trim() ? env.REDIS_URL.trim() : null;
  return {
    nodeEnv: env.NODE_ENV ?? "development",
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL,
    redisUrl,
    jwtSecret,
    accessTtlSeconds: Number(env.JWT_ACCESS_TTL_SECONDS ?? 900),
    refreshTtlDays: Number(env.JWT_REFRESH_TTL_DAYS ?? 30),
    corsOrigins: (env.CORS_ORIGIN ?? "http://localhost:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    staleAfterSeconds: Number(env.HEARTBEAT_STALE_AFTER_SECONDS ?? 45),
    trustProxy: env.TRUST_PROXY === "true",
  };
}
