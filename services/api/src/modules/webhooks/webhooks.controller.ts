import { Body, Controller, Headers, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { Public, type RequestWithUser } from "../../common/guards";
import { APP_CONFIG } from "../../common/tokens";
import type { AppConfig } from "../../config";
import { deliveryStatusFromTwilio, verifyTwilioSignature } from "../../domain/delivery";
import { AppError } from "../../domain/errors";
import { PlatformService } from "../../domain/platform-service";

@Controller("webhooks")
export class WebhooksController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
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
