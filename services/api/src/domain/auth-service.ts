import type { Role } from "@guardian/shared-types";
import { AppError } from "./errors";
import type {
  Clock,
  ConsentStore,
  IdGenerator,
  RefreshTokenStore,
  UserRecord,
  UserStore,
} from "./ports";
import {
  generateRefreshToken,
  hashToken,
  type AccessClaims,
  type PasswordHasher,
} from "./security";

export interface AccessTokenIssuer {
  sign(user: { id: string; role: Role }): Promise<string>;
  verify(token: string): Promise<AccessClaims>;
}

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
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName: string;
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
    return this.issue(user, this.ids.uuid());
  }

  async login(input: { email: string; password: string }): Promise<AuthResult> {
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
    await this.audit({ actorId: user.id, action: "auth.login", entityId: user.id });
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
