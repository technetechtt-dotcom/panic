import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { loadConfig, type AppConfig } from "./config";
import { AllExceptionsFilter, requestIdMiddleware } from "./common/http";

export function configureApp(app: INestApplication, config: AppConfig): void {
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.use(helmet());
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  if (config.trustProxy) {
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
  }
  app.enableCors({ origin: config.corsOrigins, credentials: true });
}

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule);
  configureApp(app, config);
  await app.listen(config.port);
  console.log(JSON.stringify({ level: "info", message: "guardian api listening", port: config.port }));
}

if (require.main === module) {
  void bootstrap();
}
