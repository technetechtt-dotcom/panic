import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import type { ZodType } from "zod";
import { AppError } from "../domain/errors";

export interface RequestTraceContext {
  requestId: string;
  traceId: string;
  spanId: string;
  traceparent: string;
}

export const requestContext = new AsyncLocalStorage<RequestTraceContext>();
export const requestMetrics = { total: 0, serverErrors: 0 };

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  requestMetrics.total += 1;
  const requestId = incoming && /^[A-Za-z0-9_-]{8,80}$/.test(incoming) ? incoming : randomUUID();
  const parent = parseTraceparent(req.header("traceparent"));
  const traceId = parent?.traceId ?? randomBytes(16).toString("hex");
  const spanId = randomBytes(8).toString("hex");
  const flags = parent?.flags ?? "01";
  const traceparent = `00-${traceId}-${spanId}-${flags}`;
  const startedAt = process.hrtime.bigint();

  res.setHeader("x-request-id", requestId);
  res.setHeader("traceparent", traceparent);
  (req as Request & { requestId: string }).requestId = requestId;

  res.once("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.log(JSON.stringify({
      level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      message: "http.request",
      requestId,
      traceId,
      spanId,
      parentSpanId: parent?.spanId ?? null,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    }));
  });

  requestContext.run({ requestId, traceId, spanId, traceparent }, () => next());
}

function parseTraceparent(value: string | undefined): { traceId: string; spanId: string; flags: string } | null {
  if (!value) return null;
  const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/i.exec(value.trim());
  if (!match) return null;
  if (/^0+$/.test(match[1]!) || /^0+$/.test(match[2]!)) return null;
  return { traceId: match[1]!.toLowerCase(), spanId: match[2]!.toLowerCase(), flags: match[3]!.toLowerCase() };
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
    const trace = requestContext.getStore();
    const requestId = trace?.requestId ?? null;
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
    console.error(JSON.stringify({
      level: "error",
      requestId,
      traceId: trace?.traceId ?? null,
      spanId: trace?.spanId ?? null,
      message: detail,
    }));
    response.status(500).json({
      error: { code: "INTERNAL", message: "Something went wrong.", requestId },
    });
  }
}
