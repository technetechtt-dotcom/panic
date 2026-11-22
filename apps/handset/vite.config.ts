import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@guardian/handset-wire": path.resolve(here, "../../packages/shared-validation/src/handset-wire.ts"),
    },
  },
  server: {
    port: Number(process.env.GUARDIAN_HANDSET_PORT ?? 5174),
    proxy: {
      "/api": {
        target: process.env.GUARDIAN_API_PROXY ?? "http://127.0.0.1:3000",
      },
    },
  },
});
