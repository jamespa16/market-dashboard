#!/usr/bin/env node
import { createServer } from "../src/server.js";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith("--port="));
const PORT = portArg ? Number(portArg.split("=")[1]) : Number(process.env.PORT) || 3000;

const server = createServer();

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`M&A dashboard running at ${url}`);
  openBrowser(url);
});

function openBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  const shellOpts = platform === "win32" ? { shell: true } : {};
  spawn(cmd, [url], { stdio: "ignore", detached: true, ...shellOpts }).unref();
}
