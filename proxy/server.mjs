import * as Settings from "./lib/settings.mjs";
import * as Incidents from "./lib/incidents.mjs";
import * as Backups from "./lib/backups.mjs";
import * as Dashboard from "./lib/dashboard.mjs";
// Dokploy Plus — adds modules to the Dokploy dashboard without modifying Dokploy.
//
// Traefik sends only HTML page loads and /_ext/* here (see lib/traefik.mjs):
//   - HTML pages are relayed to Dokploy and get <script src="/_ext/static/loader.js"> injected,
//   - /_ext/static/* serves the modules, /_ext/api/* their API (Dokploy session required).
// Without Traefik in front (Dokploy reached on IP:port), publish this container's port and use it
// instead of Dokploy's: every request is then relayed, WebSockets included.
import http from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Config from "./lib/config.mjs";
import * as CF from "./lib/cloudflare.mjs";
import * as Alerts from "./lib/alerts.mjs";
import * as Traefik from "./lib/traefik.mjs";

const UPSTREAM = new URL(process.env.DOKPLOY_URL || process.env.DOKPLOY_UPSTREAM || "http://dokploy:3000");
const AGENT = process.env.AGENT_URL || process.env.RAID_AGENT || "http://dokploy-plus-agent:8080";
const PORT = Number(process.env.PORT || 3000);
const VIEW_ROLES = (process.env.ALLOWED_ROLES || "owner,admin").split(",").map((r) => r.trim());
const VERSION = process.env.VERSION || process.env.EXT_VERSION || "dev";
const STATIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const TAG = `<script src="/_ext/static/branding.js" defer></script><script src="/_ext/static/loader.js?v=${encodeURIComponent(VERSION)}" defer></script>`;
const HOP = ["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection"];
const TYPES = { ".png": "image/png", ".ico": "image/x-icon", ".webp": "image/webp", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain; charset=utf-8" };

const upstream = (method, pathname, headers) =>
  http.request({ hostname: UPSTREAM.hostname, port: UPSTREAM.port || 80, method, path: pathname, headers });

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ------------------------------------------------------------ Dokploy session
// The browser's own Dokploy session is checked against tRPC user.get (role of the active
// organization). Results are cached 30 s per cookie.
const authCache = new Map();
function getUser(req) {
  const cookie = req.headers.cookie;
  if (!cookie) return Promise.resolve(null);
  const key = createHash("sha256").update(cookie).digest("hex");
  const hit = authCache.get(key);
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.user);
  return new Promise((resolve) => {
    const done = (user) => {
      if (authCache.size > 1000) authCache.clear();
      authCache.set(key, { user, exp: Date.now() + 30_000 });
      resolve(user);
    };
    const r = upstream("GET", "/api/trpc/user.get", { cookie, host: req.headers.host || UPSTREAM.host, accept: "application/json", "x-forwarded-proto": "https" });
    r.setTimeout(5000, () => r.destroy(new Error("timeout")));
    r.on("response", (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) return done(null);
        try {
          const m = JSON.parse(Buffer.concat(chunks).toString()).result?.data?.json;
          done(m?.role ? { role: m.role } : null);
        } catch { done(null); }
      });
    });
    r.on("error", () => resolve(null));
    r.end();
  });
}
const canView = (u) => !!u && VIEW_ROLES.includes(u.role);
const isOwner = (u) => u?.role === "owner";

function readBody(req, max = 16_384) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > max) { reject(new HttpError(413, "body too large")); req.destroy(); } else chunks.push(c);
    });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}")); } catch { reject(new HttpError(400, "invalid JSON")); } });
    req.on("error", reject);
  });
}

async function agentStatus() {
  const r = await fetch(`${AGENT}/status`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new HttpError(502, `agent HTTP ${r.status}`);
  return r.json();
}

const audit = (user, action) => console.log(`[audit] ${new Date().toISOString()} role=${user.role} ${action}`);

// ------------------------------------------------------------ /_ext/*
async function handleExt(req, res, url) {
  const p = url.pathname;
  if (p === "/_ext/health") return json(res, 200, { ok: true, version: VERSION });

  if (p === "/_ext/static/branding.js") {
    const title = Config.load().siteTitle || process.env.SITE_TITLE || "";
    res.writeHead(200, {"content-type":"text/javascript; charset=utf-8", "cache-control":"no-store"});
    return res.end(`(() => { const name=${JSON.stringify(title)}; if(!name)return; const update=()=>{const next=document.title.replace(/Dokploy/gi,()=>name);if(next!==document.title)document.title=next;};update();new MutationObserver(update).observe(document.head,{childList:true,subtree:true,characterData:true}); })();`);
  }
  if (p.startsWith("/_ext/static/")) {
    const rel = path.normalize(decodeURIComponent(p.slice("/_ext/static/".length)));
    const file = path.join(STATIC_DIR, rel);
    if (!file.startsWith(STATIC_DIR + path.sep)) return json(res, 404, { error: "not found" });
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "text/plain; charset=utf-8", "cache-control": "no-cache", "x-content-type-options": "nosniff" });
      return res.end(body);
    } catch { return json(res, 404, { error: "not found" }); }
  }

  if (!p.startsWith("/_ext/api/")) return json(res, 404, { error: "not found" });
  const write = req.method !== "GET";
  if (write) {
    // Same origin + custom header: cross-site requests cannot pass both.
    let sameOrigin = false;
    try { sameOrigin = new URL(req.headers.origin).host === (req.headers["x-forwarded-host"] || req.headers.host); } catch {}
    if (!sameOrigin || req.headers["x-ext-csrf"] !== "1") return json(res, 403, { error: "request refused (origin)" });
  }
  const user = await getUser(req);
  const cfg = Config.load();

  if (p === "/_ext/api/me") {
    if (!canView(user)) return json(res, 200, { allowed: false });
    return json(res, 200, {
      allowed: true, role: user.role, owner: isOwner(user), version: VERSION,
      modules: { storage: cfg.modules.storage, cloudflare: cfg.modules.cloudflare && CF.cfConfigured(), settings: true },
    });
  }
  if (!canView(user)) return json(res, user ? 403 : 401, { error: "Dokploy owner or admin session required" });

    if (["/_ext/api/operations/cleanup/preview", "/_ext/api/operations/cleanup/apply"].includes(p) && req.method === "POST") {
      if (user.role !== "owner") return json(res, 403, {error: "Owner only"});
      const body = await readBody(req, 65536);
      const token = (await readFile((process.env.DATA_DIR || "/data") + "/agent-token", "utf8")).trim();
      const r = await fetch(`${AGENT}/cleanup/${p.endsWith("preview") ? "preview" : "apply"}`, {method: "POST", headers: {"content-type":"application/json", "x-agent-token":token}, body: JSON.stringify(body), signal: AbortSignal.timeout(30000)});
      return json(res, r.status, await r.json());
    }
    if (p === "/_ext/api/operations/insights" && req.method === "GET") {
      const r = await fetch(`${AGENT}/insights`, { signal: AbortSignal.timeout(20000) });
      return json(res, r.status, await r.json());
    }
    if (p === "/_ext/api/operations/backups" && req.method === "GET") return json(res, 200, await Backups.summary(req));
    if (p === "/_ext/api/dashboard") return Dashboard.handle(req, res, url, user, { json, readBody });

  if (p === "/_ext/api/settings" || p === "/_ext/api/settings/test") return Settings.handle(req, res, user, {json, readBody, version: VERSION, traefik: Traefik.state});

  // ---- storage
  if (p === "/_ext/api/storage/status" && !write) {
    if (!cfg.modules.storage) return json(res, 404, { error: "storage module disabled" });
    try { const st = await agentStatus(); return json(res, 200, { ...st, disks: (st.disks || []).map((d) => ({ ...d, temperature_alert_c: Alerts.tempLimit(d, cfg.alerts.tempC) })), thresholds: { usage_pct: cfg.alerts.usagePct, temperature_c: cfg.alerts.tempC }, alerts: { discord: !!Config.secret("discordWebhook"), intervalMin: cfg.alerts.intervalMin } }); }
    catch (e) { return json(res, 502, { error: `storage agent unreachable: ${e.message}` }); }
  }

  // ---- cloudflare
  if (p.startsWith("/_ext/api/cf/")) {
    if (!cfg.modules.cloudflare) return json(res, 404, { error: "cloudflare module disabled" });
    const parts = p.split("/").filter(Boolean).slice(3);
    const m = req.method;
    if (parts[0] === "zones" && parts.length === 1 && m === "GET") return json(res, 200, await CF.listZones());
    const [, zone, sub, id] = parts;
    if (parts[0] === "zones" && sub === "analytics" && m === "GET") return json(res, 200, await CF.analytics(zone, url.searchParams.get("range") || "24h"));
    if (parts[0] === "zones" && sub === "dns") {
      if (!id && m === "GET") return json(res, 200, await CF.listDns(zone));
      let result;
      if (!id && m === "POST") result = await CF.createDns(zone, await readBody(req));
      else if (id && m === "PUT") result = await CF.updateDns(zone, id, await readBody(req));
      else if (id && m === "DELETE") result = await CF.deleteDns(zone, id);
      else return json(res, 405, { error: "method not allowed" });
      audit(user, `cloudflare ${m} zone=${zone} record=${result?.id || id} ${result?.type || ""} ${result?.name || ""}`);
      return json(res, 200, result);
    }
  }
  return json(res, 404, { error: "not found" });
}

// ------------------------------------------------------------ relay to Dokploy
function proxy(req, res) {
  const htmlNav = req.method === "GET" && /text\/html/.test(req.headers.accept || "");
  const headers = { ...req.headers };
  for (const h of HOP) delete headers[h];
  if (htmlNav) {
    delete headers["accept-encoding"]; // uncompressed, so it can be edited
    delete headers["if-none-match"];
    delete headers["if-modified-since"];
  }
  const up = upstream(req.method, req.url, headers);
  up.on("response", (ur) => {
    const out = { ...ur.headers };
    for (const h of HOP) delete out[h];
    const isHtml = (ur.headers["content-type"] || "").includes("text/html") && !ur.headers["content-encoding"];
    if (!htmlNav || !isHtml) { res.writeHead(ur.statusCode, out); return ur.pipe(res); }
    const chunks = [];
    ur.on("data", (c) => chunks.push(c));
    ur.on("end", () => {
      let body = Buffer.concat(chunks).toString("utf8");
      if (!body.includes("/_ext/static/loader.js")) body = body.includes("</head>") ? body.replace("</head>", `${TAG}</head>`) : body + TAG;
      delete out.etag;
      out["content-length"] = Buffer.byteLength(body);
      res.writeHead(ur.statusCode, out);
      res.end(body);
    });
    ur.on("error", () => res.destroy());
  });
  up.on("error", (e) => {
    if (!res.headersSent) { res.writeHead(502, { "content-type": "text/plain; charset=utf-8" }); res.end(`Dokploy Plus: Dokploy unreachable (${e.message})`); }
    else res.destroy();
  });
  req.pipe(up);
}

// WebSockets (logs, terminal…) when this container is used as the entry point.
function proxyUpgrade(req, socket, head) {
  const up = upstream(req.method, req.url, req.headers);
  up.on("upgrade", (ur, upSocket, upHead) => {
    socket.write(`HTTP/1.1 ${ur.statusCode} ${ur.statusMessage}\r\n${Object.entries(ur.headers).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${k}: ${x}`)).join("\r\n")}\r\n\r\n`);
    if (upHead?.length) socket.write(upHead);
    if (head?.length) upSocket.write(head);
    upSocket.pipe(socket).pipe(upSocket);
    upSocket.on("error", () => socket.destroy());
    socket.on("error", () => upSocket.destroy());
  });
  up.on("response", (r) => { socket.end(`HTTP/1.1 ${r.statusCode} ${r.statusMessage}\r\n\r\n`); });
  up.on("error", () => socket.destroy());
  up.end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/_ext/")) {
    handleExt(req, res, url).catch((e) => json(res, e.status || 500, { error: e.message }));
  } else proxy(req, res);
});
server.on("upgrade", proxyUpgrade);
server.listen(PORT, () => {
  Config.load();
  console.log(`Dokploy Plus ${VERSION} on :${PORT} -> ${UPSTREAM.href}`);
  Traefik.start();
  Alerts.start(agentStatus);
  Incidents.start(AGENT);
});
