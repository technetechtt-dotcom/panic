import { Body, Controller, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { loginSchema, mfaCodeSchema, refreshSchema, registerSchema } from "@guardian/shared-validation";
import type { AppConfig } from "../../config";
import { Public, type RequestWithUser } from "../../common/guards";
import { parseBody } from "../../common/http";
import { SlidingWindowRateLimiter } from "../../common/rate-limit";
import { APP_CONFIG } from "../../common/tokens";
import { AppError } from "../../domain/errors";
import { AuthService } from "../../domain/auth-service";

const REFRESH_COOKIE = "guardian_refresh";

function cookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict" as const,
    path: "/api/v1/auth",
    maxAge: config.refreshTtlDays * 24 * 60 * 60 * 1000,
  };
}

@Controller("auth")
export class AuthController {
  private readonly limiter = new SlidingWindowRateLimiter();

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post("register")
  async register(@Body() body: unknown, @Req() request: RequestWithUser, @Res({ passthrough: true }) response: Response) {
    this.enforceLimit(`register:${request.ip}`);
    const input = parseBody(registerSchema, body);
    const session = await this.auth.register(input);
    response.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(this.config));
    return { data: session };
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() request: RequestWithUser, @Res({ passthrough: true }) response: Response) {
    this.enforceLimit(`login:${request.ip}`);
    const input = parseBody(loginSchema, body);
    const session = await this.auth.login(input);
    if ("mfaRequired" in session) return { data: session };
    response.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(this.config));
    return { data: session };
  }

  @Public()
  @Post("mfa")
  @HttpCode(200)
  async mfa(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = parseBody(mfaCodeSchema, body);
    if (!input.mfaToken) throw new AppError("INVALID_MFA", 401, "Sign in again.");
    const session = await this.auth.completeMfa(input.mfaToken, input.code);
    response.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(this.config));
    return { data: session };
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  async refresh(@Body() body: unknown, @Req() request: RequestWithUser, @Res({ passthrough: true }) response: Response) {
    this.enforceLimit(`refresh:${request.ip}`, 30);
    const input = parseBody(refreshSchema, body ?? {});
    const cookies = (request as RequestWithUser & { cookies?: Record<string, string> }).cookies;
    const token = input.refreshToken ?? cookies?.[REFRESH_COOKIE];
    if (!token) throw new AppError("INVALID_REFRESH", 401, "Sign in again.");
    const session = await this.auth.refresh(token);
    response.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(this.config));
    return { data: session };
  }

  @Public()
  @Post("logout")
  @HttpCode(200)
  async logout(@Body() body: unknown, @Req() request: RequestWithUser, @Res({ passthrough: true }) response: Response) {
    const input = parseBody(refreshSchema, body ?? {});
    const cookies = (request as RequestWithUser & { cookies?: Record<string, string> }).cookies;
    const token = input.refreshToken ?? cookies?.[REFRESH_COOKIE];
    await this.auth.logout(token);
    response.clearCookie(REFRESH_COOKIE, {
      path: "/api/v1/auth",
      sameSite: "strict",
      secure: this.config.nodeEnv === "production",
      httpOnly: true,
    });
    return { data: { signedOut: true } };
  }

  private enforceLimit(key: string, limit = this.config.nodeEnv === "production" ? 10 : 100): void {
    if (!this.limiter.allow(key, limit, 15 * 60 * 1000)) {
      throw new AppError("RATE_LIMITED", 429, "Too many sign-in attempts. Wait a few minutes and try once.");
    }
  }
}
