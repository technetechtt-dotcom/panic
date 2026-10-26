import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { json, urlencoded } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { loadConfig, type AppConfig } from "./config";
import { AllExceptionsFilter, requestIdMiddleware } from "./common/http";
import { apnsHealth, fcmHealth, smsHealth } from "./domain/sms";

export function configureApp(app: INestApplication, config: AppConfig): void {
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.use(helmet());
  app.use(json({ limit: "4mb" }));
  app.use(urlencoded({ extended: false, limit: "4mb" }));
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  if (config.trustProxy) {
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
  }
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.enableShutdownHooks();
}

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app, config);
  await app.listen(config.port);
  console.log(JSON.stringify({
    level: "info",
    message: "guardian api listening",
    port: config.port,
    sms: smsHealth(),
    fcm: fcmHealth(),
    apns: apnsHealth(),
    smtp: process.env.SMTP_URL?.trim() ? "configured" : "not configured",
  }));
}

if (require.main === module) {
  void bootstrap();
}
