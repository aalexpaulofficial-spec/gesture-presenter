// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";
import { globalSessionTracker } from "./src/lib/session-tracker";

function liveStatsDevPlugin(): Plugin {
  return {
    name: "live-stats-dev-middleware",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        if (url === "/stats/live" && req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          res.end(JSON.stringify({ active_users: globalSessionTracker.getActiveCount() }));
          return;
        }

        if (url === "/sessions/heartbeat" && req.method === "POST") {
          let body = "";
          req.on("data", (chunk: any) => {
            body += chunk;
          });
          req.on("end", () => {
            try {
              const data = JSON.parse(body);
              if (data.client_id) {
                const active = globalSessionTracker.heartbeat(data.client_id, data.session_id);
                res.setHeader("Content-Type", "application/json");
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.end(JSON.stringify({ status: "ok", active_users: active }));
                return;
              }
            } catch {
              // ignore
            }
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid payload" }));
          });
          return;
        }

        if (url === "/sessions/end" && req.method === "POST") {
          let body = "";
          req.on("data", (chunk: any) => {
            body += chunk;
          });
          req.on("end", () => {
            try {
              if (body) {
                const data = JSON.parse(body);
                if (data.client_id) {
                  const active = globalSessionTracker.endSession(data.client_id, data.session_id);
                  res.setHeader("Content-Type", "application/json");
                  res.setHeader("Access-Control-Allow-Origin", "*");
                  res.end(JSON.stringify({ status: "ok", active_users: active }));
                  return;
                }
              }
            } catch {
              // ignore
            }
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.end(JSON.stringify({ status: "ok" }));
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  vite: {
    plugins: [liveStatsDevPlugin()],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
