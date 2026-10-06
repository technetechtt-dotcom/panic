import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import type { ZodType } from "zod";
import { AppError } from "../domain/errors";

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
export const requestMetrics = { total: 0, serverErrors: 0 };

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  requestMetrics.total += 1;
  const requestId = incoming && /^[A-Za-z0-9_-]{8,80}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader("x-request-id", requestId);
  (req as Request & { requestId: string }).requestId = requestId;
  requestContext.run({ requestId }, () => next());
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(" ");
    throw new AppError("VALIDATION_ERROR", 400, message || "The request is invalid.");
  }
  return parsed.data;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== "http") return;
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const requestId = requestContext.getStore()?.requestId ?? null;
    if (exception instanceof AppError) {
      response.status(exception.status).json({
        error: { code: exception.code, message: exception.message, requestId },
      });
      return;
    }
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json({
        error: { code: "HTTP_ERROR", message: exception.message, requestId },
      });
      return;
    }
    requestMetrics.serverErrors += 1;
    const detail = exception instanceof Error ? exception.message : "unknown";
    console.error(JSON.stringify({ level: "error", requestId, message: detail }));
    response.status(500).json({
      error: { code: "INTERNAL", message: "Something went wrong.", requestId },
    });
  }
}
