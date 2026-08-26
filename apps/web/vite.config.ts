import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src")
    }
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: Number(process.env.CODEX_OMNI_WEB_PORT ?? 5173),
    strictPort: true,
    watch: {
      // Polling keeps HMR reliable in VMs, containers and remote-mounted workspaces.
      usePolling: true,
      interval: 300,
      ignored: ["**/apps/server/data/**", "**/*.db", "**/*.db-*", "**/node_modules/**"]
    },
    proxy: {
      "/api": {
        target: process.env.CODEX_OMNI_API_URL ?? "http://127.0.0.1:8790",
        changeOrigin: true,
        ws: true
      }
    }
  }
});
