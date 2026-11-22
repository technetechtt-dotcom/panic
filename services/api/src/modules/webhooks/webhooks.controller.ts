import { Body, Controller, Headers, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { Public, type RequestWithUser } from "../../common/guards";
import { APP_CONFIG } from "../../common/tokens";
import type { AppConfig } from "../../config";
import { timingSafeEqual } from "node:crypto";
import { deliveryStatusFromTwilio, verifyTwilioSignature } from "../../domain/delivery";
import { AppError } from "../../domain/errors";
import { NarrowbandIngress } from "../../domain/narrowband-ingress";
import { PlatformService } from "../../domain/platform-service";

@Controller("webhooks")
export class WebhooksController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(NarrowbandIngress) private readonly narrowband: NarrowbandIngress,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post("twilio/sms")
  @HttpCode(204)
  async twilioSms(
    @Body() body: Record<string, string>,
    @Headers("x-twilio-signature") signature: string | undefined,
    @Req() request: RequestWithUser,
  ) {
    this.assertTwilio(request, body, signature);
    const inbound = (body.Body || "").trim();
    if (inbound.startsWith("G1.")) {
      await this.narrowband.acceptSms(inbound);
      return;
    }
    const sid = body.MessageSid || body.SmsSid;
    const status = (body.MessageStatus || body.SmsStatus || "").toLowerCase();
    if (!sid) return;
    await this.platform.applyDeliveryReceipt({
      providerMessageId: sid,
      channel: "SMS",
      status: deliveryStatusFromTwilio(status),
      detail: status || "twilio callback",
      failureCode: body.ErrorCode,
    });
  }

  @Public()
  @Post("push/receipt")
  @HttpCode(204)
  async pushReceipt(@Body() body: Record<string, string>, @Headers("x-guardian-webhook") secret: string | undefined) {
    const expected = process.env.PUSH_WEBHOOK_SECRET?.trim();
    if (!expected || secret !== expected) throw new AppError("UNAUTHENTICATED", 401, "Push receipt secret was not accepted.");
    if (!body.providerMessageId) return;
    await this.platform.applyDeliveryReceipt({
      providerMessageId: body.providerMessageId,
      channel: body.channel === "APNS" ? "APNS" : "FCM",
      status: body.status === "delivered" ? "DELIVERED" : "FAILED",
      detail: body.detail || "provider receipt",
      failureCode: body.failureCode,
    });
  }

  @Public()
  @Post("iridium/sbd")
  @HttpCode(204)
  async iridium(
    @Body() body: { imei?: string; payload?: string; data?: string },
    @Headers("x-guardian-iridium") secret: string | undefined,
  ) {
    this.assertIridium(secret);
    const imei = (body.imei || "").trim();
    const payload = body.payload || body.data || "";
    if (!/^\d{15}$/.test(imei) || !payload.trim()) {
      throw new AppError("VALIDATION", 422, "An Iridium message needs a 15-digit IMEI and a payload.");
    }
    await this.narrowband.acceptSatellite(imei, payload);
  }

  private assertIridium(secret: string | undefined): void {
    const expected = process.env.IRIDIUM_WEBHOOK_SECRET?.trim() ?? "";
    if (!expected) {
      if (this.config.nodeEnv === "production") throw new AppError("UNAUTHENTICATED", 401, "Iridium is not configured.");
      return;
    }
    if (!secretMatches(secret, expected)) throw new AppError("UNAUTHENTICATED", 401, "Iridium signature was not accepted.");
  }

  private assertTwilio(request: RequestWithUser, body: Record<string, string>, signature: string | undefined): void {
    const token = process.env.TWILIO_AUTH_TOKEN?.trim();
    if (!token) {
      if (this.config.nodeEnv === "production") throw new AppError("UNAUTHENTICATED", 401, "Twilio is not configured.");
      return;
    }
    const proto = (request.headers["x-forwarded-proto"] as string | undefined) ?? request.protocol;
    const host = request.headers.host ?? "localhost";
    const url = `${proto}://${host}${request.originalUrl.split("?")[0]}`;
    if (!verifyTwilioSignature(url, body, signature, token)) {
      throw new AppError("UNAUTHENTICATED", 401, "Twilio signature was not accepted.");
    }
  }
}

function secretMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
