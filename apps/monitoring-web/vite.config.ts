import type { ServerResponse } from "node:http";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

function apiUnavailable(_proxy: unknown, _req: unknown, res: object): void {
  const response = res as ServerResponse;
  if (response.headersSent || typeof response.writeHead !== "function") return;
  response.writeHead(503, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      error: {
        code: "API_UNAVAILABLE",
        message: "The Guardian API is not running. Start PostgreSQL, then run npm run dev:api.",
      },
    }),
  );
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", configure: (proxy) => proxy.on("error", apiUnavailable) },
      "/socket.io": {
        target: "http://127.0.0.1:3000",
        ws: true,
        configure: (proxy) => proxy.on("error", apiUnavailable),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
});
