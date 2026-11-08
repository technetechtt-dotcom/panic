// Load before Nest/http so the instrumentation can patch modules before first use.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { NestInstrumentation } from "@opentelemetry/instrumentation-nestjs-core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || "guardian-api",
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [new HttpInstrumentation({
      // Capability URLs and exact routed coordinates must not enter a third-party trace store.
      ignoreIncomingRequestHook: request => /\/rooms\/|\/room\//.test(request.url ?? ""),
      ignoreOutgoingRequestHook: request => /\/room|\/route\/|\/search|\/geocode/.test(String(request.path ?? "")),
    }), new NestInstrumentation()],
  });
  sdk.start();
  process.once("SIGTERM", () => { void sdk.shutdown(); });
}
