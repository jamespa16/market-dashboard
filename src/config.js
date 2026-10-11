// Runtime configuration shared by the CLI and the server modules.
// Values come from env vars by default; bin/cli.js overrides them from flags via setConfig().

const config = {
  host: process.env.MA_DASHBOARD_HOST || "127.0.0.1",
  port: Number(process.env.PORT) || 3000,
  // SEC fair-access policy: requests must identify the requester with contact info.
  // Users should set this to their own email; see README.
  secContact: process.env.MA_DASHBOARD_SEC_CONTACT || process.env.SEC_CONTACT || "",
};

export function getConfig() {
  return config;
}

export function setConfig(overrides) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) config[key] = value;
  }
  return config;
}

export function secUserAgent() {
  // SEC rejects User-Agents containing URLs, so with no contact configured send the bare product token.
  return config.secContact ? `ma-dashboard/0.1 (contact: ${config.secContact})` : "ma-dashboard/0.1";
}
