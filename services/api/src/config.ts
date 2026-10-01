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
