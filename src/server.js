import http from "node:http";
import { handleApi } from "./api.js";
import { serveStatic } from "./static.js";

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (await handleApi(req, res, url)) return;
    await serveStatic(req, res);
  });
}
