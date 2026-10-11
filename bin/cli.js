#!/usr/bin/env node
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createServer } from "../src/server.js";
import { getConfig, setConfig } from "../src/config.js";

const USAGE = `Usage: ma-dashboard [options]

Options:
  --port <n>             Port to listen on (default: 3000, or PORT env var)
  --host <addr>          Address to bind (default: 127.0.0.1; use 0.0.0.0 for LAN access)
  --no-open              Don't open a browser window on start
  --sec-contact <email>  Contact info for the SEC User-Agent (or MA_DASHBOARD_SEC_CONTACT)
  -v, --version          Print the version and exit
  -h, --help             Show this help and exit`;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
// Hosts that mean "all interfaces" or "loopback" and read best as localhost in the printed URL.
const LOCAL_ALIAS_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0", "::"]);

const PACKAGE_JSON_URL = new URL("../package.json", import.meta.url);

function parsePort(value) {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= 65535 ? n : null;
}

// Pure argument parser. Returns one of:
//   { options: { port, host, open, secContact } }
//   { help: true } | { version: "x.y.z" } | { error: "message" }
export function parseCliArgs(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        port: { type: "string" },
        host: { type: "string" },
        "no-open": { type: "boolean" },
        "sec-contact": { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
      allowPositionals: false,
      strict: true,
    }));
  } catch (err) {
    return { error: err.message };
  }

  if (values.help) return { help: true };

  if (values.version) {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_URL, "utf8"));
    return { version: pkg.version };
  }

  let port;
  if (values.port !== undefined) {
    port = parsePort(values.port);
    if (port === null) {
      return { error: `Invalid port "${values.port}". Use an integer between 1 and 65535.` };
    }
  }

  if (values.host !== undefined && values.host.trim() === "") {
    return { error: "--host needs a non-empty address." };
  }

  return {
    options: {
      port,
      host: values.host,
      open: !values["no-open"],
      secContact: values["sec-contact"],
    },
  };
}

function main(argv) {
  const result = parseCliArgs(argv);

  if (result.error) {
    console.error(`Error: ${result.error}\n`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (result.help) {
    console.log(USAGE);
    return;
  }
  if (result.version) {
    console.log(result.version);
    return;
  }

  const { options } = result;
  setConfig({ host: options.host, port: options.port, secContact: options.secContact });
  const { host, port, secContact } = getConfig();

  if (!secContact) {
    console.log(
      "Note: no SEC contact set. Pass --sec-contact <email> or set MA_DASHBOARD_SEC_CONTACT (SEC asks for contact info in the User-Agent)."
    );
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    console.log(`Warning: binding to ${host} makes the dashboard reachable from the network.`);
  }

  const displayHost = LOCAL_ALIAS_HOSTS.has(host) ? "localhost" : host;
  const url = `http://${displayHost.includes(":") ? `[${displayHost}]` : displayHost}:${port}`;

  const server = createServer();

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Try another port with --port <n>.`);
    } else {
      console.error(`Failed to start server: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(`M&A dashboard running at ${url}`);
    if (options.open) openBrowser(url);
  });
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  const shellOpts = platform === "win32" ? { shell: true } : {};
  const child = spawn(cmd, [url], { stdio: "ignore", detached: true, ...shellOpts });
  child.on("error", () => console.log(`Open ${url} in your browser.`));
  child.unref();
}

// Start only when executed directly (npm bins are symlinks, so resolve them first).
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) main(process.argv.slice(2));
