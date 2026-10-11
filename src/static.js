import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.join(__dirname, "..", "public");

export const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendText(res, status, message, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(message);
}

export async function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method Not Allowed", { Allow: "GET, HEAD" });
    return;
  }

  let pathname;
  try {
    // Strip query string and hash, then decode percent-encoding.
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    sendText(res, 400, "Bad Request");
    return;
  }

  if (pathname.includes("\0")) {
    sendText(res, 400, "Bad Request");
    return;
  }

  if (pathname === "/") pathname = "/index.html";

  // Prevent path traversal: the result must be inside PUBLIC_DIR (or be PUBLIC_DIR itself).
  const filePath = path.resolve(PUBLIC_DIR, "." + pathname);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  let content;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error("not a regular file");
    content = await fs.readFile(filePath);
  } catch {
    sendText(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Content-Length": content.length,
    "X-Content-Type-Options": "nosniff",
  });
  // Node omits the body for HEAD responses automatically; end() still sends headers.
  res.end(req.method === "HEAD" ? undefined : content);
}
