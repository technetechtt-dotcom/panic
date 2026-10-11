import type { Role } from "@guardian/shared-types";
import { AppError } from "./errors";
import { randomBytes } from "node:crypto";
import type {
  Clock,
  ConsentStore,
  IdGenerator,
  RecoveryStore,
  RefreshTokenStore,
  UserRecord,
  UserStore,
} from "./ports";
import type { RecoveryRecord } from "./ports";

class MemoryRecovery implements RecoveryStore {
  private readonly rows = new Map<string, RecoveryRecord>();
  async insert(record: RecoveryRecord): Promise<void> {
    this.rows.set(`${record.purpose}:${record.tokenHash}`, record);
  }
  async consume(tokenHash: string, purpose: RecoveryRecord["purpose"], now: Date): Promise<string | null> {
    const row = this.rows.get(`${purpose}:${tokenHash}`);
    if (!row || row.consumedAt || row.expiresAt.getTime() < now.getTime()) return null;
    row.consumedAt = now;
    return row.userId;
  }
}
import { generateTotpSecret, readMfaChallenge, signMfaChallenge, verifyTotp } from "./operations";
import {
  generateRefreshToken,
  hashToken,
  type AccessClaims,
  type PasswordHasher,
} from "./security";

export interface MfaStore {
  isEnabled(userId: string): Promise<boolean>;
  secret(userId: string): Promise<string | null>;
  prepareEnrollment?(userId: string, secret: string): Promise<void>;
  enable?(userId: string): Promise<void>;
}

export interface AccessTokenIssuer {
  sign(user: { id: string; role: Role }): Promise<string>;
  verify(token: string): Promise<AccessClaims>;
}

const MFA_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MONITOR_OPERATOR", "RESPONDER"];

function deepLinks(kind: "verify" | "reset" | "invite", token: string): { deepLink: string; appLink: string } {
  const httpsBase = (process.env.DEEP_LINK_BASE ?? "https://links.guardian.app").replace(/\/$/, "");
  const path = kind === "verify" ? "v" : kind === "reset" ? "r" : "i";
  return {
    deepLink: `${httpsBase}/${path}/${encodeURIComponent(token)}`,
    appLink: `guardian://${kind}?token=${encodeURIComponent(token)}`,
  };
}

export function invitationDeepLinks(token: string): { deepLink: string; appLink: string } {
  return deepLinks("invite", token);
}

export type LoginResult =
  | AuthResult
  | { mfaRequired: true; mfaToken: string }
  | { mfaEnrollmentRequired: true; mfaToken: string; secret: string; otpauth: string };

export interface AuthResult {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: Role;
  };
}

export class AuthService {
  constructor(
    private readonly users: UserStore,
    private readonly refreshTokens: RefreshTokenStore,
    private readonly consents: ConsentStore,
    private readonly passwords: PasswordHasher,
    private readonly accessTokens: AccessTokenIssuer,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly refreshTtlDays: number,
    private readonly accessTtlSeconds: number,
    private readonly audit: (event: {
      actorId: string | null;
      action: string;
      entityId: string;
      metadata?: Record<string, unknown>;
    }) => Promise<void>,
    private readonly mfa: { store: MfaStore; secret: string } | null = null,
    private readonly recovery: RecoveryStore = new MemoryRecovery(),
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName: string;
    phone?: string;
  }): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new AppError("EMAIL_IN_USE", 409, "An account with this email already exists.");
    }
    const now = this.clock.now();
    const user: UserRecord = {
      id: this.ids.uuid(),
      email,
      passwordHash: await this.passwords.hash(input.password),
      displayName: input.displayName.trim(),
      role: "USER",
      phone: input.phone?.trim() || null,
      createdAt: now,
      updatedAt: now,
    };
    await this.users.insert(user);
    await this.consents.insert({
      id: this.ids.uuid(),
      userId: user.id,
      purpose: "SAFETY_LOCATION_AND_INCIDENT",
      version: "2026-10-01",
      granted: true,
      createdAt: now,
    });
    await this.audit({ actorId: user.id, action: "auth.register", entityId: user.id });
    await this.issueEmailToken(user.id);
    return this.issue(user, this.ids.uuid());
  }

  async requestPasswordReset(email: string): Promise<{ accepted: true; emailSent: boolean; deepLink?: string; appLink?: string; devToken?: string }> {
    const user = await this.users.findByEmail(email.trim().toLowerCase());
    const emailSent = Boolean(process.env.SMTP_URL?.trim());
    if (!user) return { accepted: true, emailSent };
    const token = randomBytes(24).toString("base64url");
    await this.recovery.insert({
      tokenHash: hashToken(token),
      userId: user.id,
      purpose: "PASSWORD_RESET",
      expiresAt: new Date(this.clock.now().getTime() + 30 * 60 * 1000),
      consumedAt: null,
    });
    await this.audit({ actorId: user.id, action: "auth.password_reset_requested", entityId: user.id });
    const links = deepLinks("reset", token);
    return process.env.NODE_ENV === "production"
      ? { accepted: true, emailSent, ...links }
      : { accepted: true, emailSent, ...links, devToken: token };
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const userId = await this.recovery.consume(hashToken(token), "PASSWORD_RESET", this.clock.now());
    if (!userId) throw new AppError("INVALID_RESET", 400, "That reset link is not valid or has expired.");
    const user = await this.users.findById(userId);
    if (!user) throw new AppError("INVALID_RESET", 400, "That reset link is not valid or has expired.");
    user.passwordHash = await this.passwords.hash(password);
    user.updatedAt = this.clock.now();
    await this.users.save?.(user);
    await this.audit({ actorId: user.id, action: "auth.password_reset", entityId: user.id });
  }

  async requestEmailVerification(userId: string): Promise<{ emailSent: boolean; deepLink?: string; appLink?: string; devToken?: string }> {
    const token = await this.issueEmailToken(userId);
    const emailSent = Boolean(process.env.SMTP_URL?.trim());
    const links = deepLinks("verify", token);
    return process.env.NODE_ENV === "production" ? { emailSent, ...links } : { emailSent, ...links, devToken: token };
  }

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.recovery.consume(hashToken(token), "EMAIL_VERIFY", this.clock.now());
    if (!userId) throw new AppError("INVALID_VERIFY", 400, "That verification link is not valid or has expired.");
    const user = await this.users.findById(userId);
    if (!user) throw new AppError("INVALID_VERIFY", 400, "That verification link is not valid or has expired.");
    user.emailVerifiedAt = this.clock.now();
    user.updatedAt = this.clock.now();
    await this.users.save?.(user);
    await this.audit({ actorId: user.id, action: "auth.email_verified", entityId: user.id });
  }

  private async issueEmailToken(userId: string): Promise<string> {
    const token = randomBytes(24).toString("base64url");
    try {
      await this.recovery.insert({
        tokenHash: hashToken(token),
        userId,
        purpose: "EMAIL_VERIFY",
        expiresAt: new Date(this.clock.now().getTime() + 24 * 60 * 60 * 1000),
        consumedAt: null,
      });
    } catch {
      // Registration still succeeds if the recovery table is unavailable.
    }
    return token;
  }

  async login(input: { email: string; password: string }): Promise<LoginResult> {
    const email = input.email.trim().toLowerCase();
    const user = await this.users.findByEmail(email);
    const valid = user ? await this.passwords.verify(input.password, user.passwordHash) : false;
    if (!user || !valid) {
      await this.audit({
        actorId: user?.id ?? null,
        action: "auth.login_failed",
        entityId: user?.id ?? "unknown",
      });
      throw new AppError("INVALID_CREDENTIALS", 401, "Invalid email or password.");
    }
    if (this.mfa && MFA_ROLES.includes(user.role)) {
      const token = signMfaChallenge(this.mfa.secret, user.id, this.clock.now().getTime() + 5 * 60 * 1000);
      if (await this.mfa.store.isEnabled(user.id)) {
        return { mfaRequired: true, mfaToken: token };
      }
      const secret = generateTotpSecret();
      await this.mfa.store.prepareEnrollment?.(user.id, secret);
      return {
        mfaEnrollmentRequired: true,
        mfaToken: token,
        secret,
        otpauth: `otpauth://totp/Guardian:${encodeURIComponent(user.email)}?secret=${secret}&issuer=Guardian`,
      };
    }
    await this.audit({ actorId: user.id, action: "auth.login", entityId: user.id });
    return this.issue(user, this.ids.uuid());
  }

  async completeMfa(mfaToken: string, code: string): Promise<AuthResult> {
    if (!this.mfa) throw new AppError("MFA_UNAVAILABLE", 409, "Authenticator sign-in is not configured.");
    const userId = readMfaChallenge(this.mfa.secret, mfaToken, this.clock.now().getTime());
    const secret = userId ? await this.mfa.store.secret(userId) : null;
    if (!userId || !secret || !verifyTotp(secret, code, this.clock.now().getTime())) {
      throw new AppError("INVALID_MFA", 401, "That authenticator code was not accepted.");
    }
    const user = await this.users.findById(userId);
    if (!user) throw new AppError("INVALID_MFA", 401, "That authenticator code was not accepted.");
    await this.mfa.store.enable?.(userId);
    await this.audit({ actorId: user.id, action: "auth.mfa", entityId: user.id });
    return this.issue(user, this.ids.uuid());
  }

  async refresh(rawToken: string): Promise<AuthResult> {
    const record = await this.refreshTokens.findByHash(hashToken(rawToken));
    if (!record) {
      throw new AppError("INVALID_REFRESH", 401, "Sign in again.");
    }
    const now = this.clock.now();
    if (record.revokedAt) {
      await this.refreshTokens.revokeFamily(record.familyId, now);
      await this.audit({
        actorId: record.userId,
        action: "auth.refresh_reuse",
        entityId: record.userId,
      });
      throw new AppError("INVALID_REFRESH", 401, "Sign in again.");
    }
    if (record.expiresAt.getTime() <= now.getTime()) {
      throw new AppError("INVALID_REFRESH", 401, "Sign in again.");
    }
    const user = await this.users.findById(record.userId);
    if (!user) throw new AppError("INVALID_REFRESH", 401, "Sign in again.");
    const replacementId = this.ids.uuid();
    await this.refreshTokens.revoke(record.id, now, replacementId);
    await this.audit({ actorId: user.id, action: "auth.refresh", entityId: user.id });
    return this.issue(user, record.familyId, replacementId);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const record = await this.refreshTokens.findByHash(hashToken(rawToken));
    if (!record || record.revokedAt) return;
    await this.refreshTokens.revoke(record.id, this.clock.now());
    await this.audit({ actorId: record.userId, action: "auth.logout", entityId: record.userId });
  }

  private async issue(user: UserRecord, familyId: string, tokenId = this.ids.uuid()): Promise<AuthResult> {
    const now = this.clock.now();
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(now.getTime() + this.refreshTtlDays * 24 * 60 * 60 * 1000);
    await this.refreshTokens.insert({
      id: tokenId,
      userId: user.id,
      familyId,
      tokenHash: hashToken(refreshToken),
      expiresAt,
      revokedAt: null,
      replacedById: null,
      createdAt: now,
    });
    const accessToken = await this.accessTokens.sign({ id: user.id, role: user.role });
    return {
      accessToken,
      accessTokenExpiresInSeconds: this.accessTtlSeconds,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
    };
  }
}
