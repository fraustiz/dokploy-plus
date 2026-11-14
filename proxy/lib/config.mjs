// Settings store: /data/config.json (+ /data/.key). Secrets are encrypted with AES-256-GCM.
// The key lives next to the data (same volume): this protects against accidental leaks of the
// config file (copy, backup, screenshot), not against someone who already has root on the host.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const DATA = process.env.DATA_DIR || "/data";
const FILE = path.join(DATA, "config.json");
const KEY_FILE = path.join(DATA, ".key");
const SECRET_FIELDS = ["cloudflareToken", "discordWebhook", "jellyfinToken", "homeassistantToken", "beszelEmail", "beszelPassword", "uptimeKumaKey", "sonarrKey", "radarrKey", "speedtestToken", "piholePassword"];

const DEFAULTS = {
  modules: { storage: true, cloudflare: true },
  alerts: { usagePct: 90, tempC: 55, intervalMin: 10 },
  secrets: {},
};

let key;
let cfg;

function readText(p) {
  try { return readFileSync(p, "utf8").trim(); } catch { return null; }
}

function loadKey() {
  if (key) return key;
  mkdirSync(DATA, { recursive: true, mode: 0o700 });
  if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, randomBytes(32).toString("base64"), { mode: 0o600 });
  key = Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "base64");
  return key;
}

function enc(text) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", loadKey(), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}
function dec(blob) {
  const [v, iv, tag, data] = String(blob).split(":");
  if (v !== "v1") return null;
  const d = createDecipheriv("aes-256-gcm", loadKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

function save() {
  mkdirSync(DATA, { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  renameSync(tmp, FILE);
}

// First start: optional bootstrap from environment / secret files (handy for migrations
// and for people who prefer Docker secrets). Never overrides settings saved from the UI.
function bootstrap() {
  cfg = structuredClone(DEFAULTS);
  const mods = process.env.MODULES;
  if (mods) {
    const on = new Set(mods.split(",").map((m) => m.trim()));
    cfg.modules = { storage: on.has("storage"), cloudflare: on.has("cloudflare") };
  }
  const cf = process.env.CLOUDFLARE_TOKEN || readText(process.env.CLOUDFLARE_TOKEN_FILE || "/run/secrets/cloudflare-token");
  if (cf) cfg.secrets.cloudflareToken = enc(cf);
  const hook = process.env.DISCORD_WEBHOOK || readText(process.env.DISCORD_WEBHOOK_FILE || "/run/secrets/discord-webhook");
  if (hook) cfg.secrets.discordWebhook = enc(hook);
  for (const [k, env] of [["usagePct", "ALERT_USAGE_PCT"], ["tempC", "ALERT_TEMP_C"]]) {
    if (process.env[env]) cfg.alerts[k] = Number(process.env[env]);
  }
  save();
  console.log(`[config] created ${FILE} (modules: ${Object.entries(cfg.modules).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"})`);
}

export function load() {
  if (cfg) return cfg;
  const raw = readText(FILE);
  if (!raw) bootstrap();
  else {
    const j = JSON.parse(raw);
    cfg = { ...structuredClone(DEFAULTS), ...j, modules: { ...DEFAULTS.modules, ...j.modules }, alerts: { ...DEFAULTS.alerts, ...j.alerts }, secrets: j.secrets || {} };
  }
  return cfg;
}

// Base URL of a connected service: Settings value, otherwise the first Dashboard card using it.
export function serviceUrl(id) {
  const c = load();
  return String(c.integrations?.[id]?.url || c.dashboard?.apps?.find((a) => a.integration === id)?.url || "").replace(/\/+$/, "");
}

export function secret(name) {
  const blob = load().secrets[name];
  if (!blob) return null;
  try { return dec(blob); } catch { return null; }
}

export function setSecret(name, value) {
  if (!SECRET_FIELDS.includes(name)) throw new Error(`unknown secret ${name}`);
  if (value) load().secrets[name] = enc(value);
  else delete load().secrets[name];
  save();
}

export function update(patch) {
  const c = load();
  if (patch.dashboard) c.dashboard = patch.dashboard;
  if (patch.integrations) c.integrations = patch.integrations;
  if (patch.update) c.update = patch.update;
  if ("siteTitle" in patch) c.siteTitle = patch.siteTitle;
  if (patch.modules) for (const k of Object.keys(DEFAULTS.modules)) if (k in patch.modules) c.modules[k] = !!patch.modules[k];
  if (patch.alerts) for (const k of Object.keys(DEFAULTS.alerts)) if (k in patch.alerts) c.alerts[k] = patch.alerts[k];
  save();
  return c;
}

// Public view: never returns secret values.
export function publicView() {
  const c = load();
  return {
    modules: c.modules,
    alerts: c.alerts,
    cloudflare: { configured: !!c.secrets.cloudflareToken },
    discord: { configured: !!c.secrets.discordWebhook },
  };
}
