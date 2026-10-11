import http from "node:http";
import { handleApi } from "./api.js";
import { serveStatic } from "./static.js";

// options.log: set false to silence per-request logging (also silenced when NODE_ENV=test).
export function createServer(options = {}) {
  const logEnabled = options.log !== false && process.env.NODE_ENV !== "test";

  return http.createServer(async (req, res) => {
    const start = process.hrtime.bigint();
    const logPath = (req.url || "/").split("?")[0];

    if (logEnabled) {
      res.on("finish", () => {
        const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
        console.log(`${req.method} ${logPath} ${res.statusCode} ${durationMs}ms`);
      });
    }

    try {
      const url = new URL(req.url, "http://localhost");
      if (await handleApi(req, res, url)) return;
      await serveStatic(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });
}
