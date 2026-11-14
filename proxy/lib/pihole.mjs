// Pi-hole v6 API with an application password. One session is shared by every request and renewed
// on 401. Pi-hole checks at most 3 passwords per second (all clients together) and keeps 16 API
// sessions by default, so concurrent requests wait for a single login instead of each logging in.
// With app_sudo off (Pi-hole default), the app password can manage blocking and domain lists but
// cannot change Pi-hole's configuration.
import * as Config from "./config.mjs";

const BLOCKED = new Set(["GRAVITY", "REGEX", "DENYLIST", "GRAVITY_CNAME", "REGEX_CNAME", "DENYLIST_CNAME", "EXTERNAL_BLOCKED_IP", "EXTERNAL_BLOCKED_NULL", "EXTERNAL_BLOCKED_NXRA", "EXTERNAL_BLOCKED_EDE15", "SPECIAL_DOMAIN"]);
const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const baseOf = (url) => String(url || "").replace(/\/+$/, "").replace(/\/admin$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let session = null; // { key, sid }
let pending = null; // { key, promise }: login in progress

export const configured = () => !!Config.serviceUrl("pihole") && !!Config.secret("piholePassword");

async function login(base, password) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(base + "/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }), redirect: "error", signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => null);
    if (r.ok && j?.session?.valid) return j.session.sid;
    const reason = j?.error?.key;
    // Another client used this second's password checks: try again in the next second.
    if (r.status === 429 && reason === "rate_limiting" && attempt < 3) { await sleep(1100); continue; }
    if (reason === "api_seats_exceeded") fail(502, "Pi-hole has no free API session (webserver.api.max_sessions); unused sessions expire after webserver.session.timeout");
    fail(502, r.status === 401 ? "Pi-hole refused the app password" : `Pi-hole login failed (HTTP ${r.status})`);
  }
}

function sharedSid(base, password) {
  const key = base + "|" + password;
  if (session?.key === key) return Promise.resolve(session.sid);
  if (pending?.key === key) return pending.promise;
  const promise = login(base, password).then(
    (sid) => { if (pending?.promise === promise) pending = null; session = { key, sid }; return sid; },
    (e) => { if (pending?.promise === promise) pending = null; throw e; });
  pending = { key, promise };
  return promise;
}

async function call(path, { method = "GET", body, base = baseOf(Config.serviceUrl("pihole")), password = Config.secret("piholePassword"), shared = true } = {}) {
  if (!base || !password) fail(404, "Pi-hole is not configured");
  for (let attempt = 0; attempt < 2; attempt++) {
    const sid = shared ? await sharedSid(base, password) : await login(base, password);
    let r, text;
    try {
      r = await fetch(base + "/api" + path, { method, headers: { "X-FTL-SID": sid, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "error", signal: AbortSignal.timeout(20000) });
      text = await r.text();
    } finally {
      if (!shared) await fetch(base + "/api/auth", { method: "DELETE", headers: { "X-FTL-SID": sid }, signal: AbortSignal.timeout(5000) }).catch(() => {});
    }
    // Expired session: forget it once (concurrent requests share the next login) and retry.
    if (r.status === 401 && shared && attempt === 0) { if (session?.sid === sid) session = null; continue; }
    let j = null; try { j = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok) fail(r.status === 400 || r.status === 404 ? 400 : 502, j?.error?.message ? `Pi-hole: ${j.error.message}${j.error.hint ? ` (${j.error.hint})` : ""}` : `Pi-hole HTTP ${r.status}`);
    return j;
  }
  fail(502, "Pi-hole session refused");
}

const blocking = (b) => ({ state: b?.blocking || "unknown", timer: typeof b?.timer === "number" ? Math.round(b.timer) : null });

// Dashboard card and Settings test.
export async function card(base, password) {
  if (!password) return { online: null, configured: false };
  const opts = { base: baseOf(base), password };
  const [s, b] = await Promise.all([call("/stats/summary", opts), call("/dns/blocking", opts)]);
  return { online: true, configured: true, total: s.queries?.total ?? null, blocked: s.queries?.blocked ?? null, percent: s.queries?.percent_blocked ?? null, blocking: blocking(b) };
}
export async function test(base, password) {
  const s = await call("/stats/summary", { base: baseOf(base), password, shared: false });
  return `Connected. ${Math.round(s.queries?.percent_blocked || 0)}% of ${s.queries?.total ?? 0} queries blocked today.`;
}

export async function overview() {
  const [s, b, h, tb, tp, tc] = await Promise.all([
    call("/stats/summary"), call("/dns/blocking"), call("/history"),
    call("/stats/top_domains?blocked=true&count=10"), call("/stats/top_domains?count=10"), call("/stats/top_clients?count=8"),
  ]);
  return {
    blocking: blocking(b),
    queries: { total: s.queries?.total ?? 0, blocked: s.queries?.blocked ?? 0, percent: s.queries?.percent_blocked ?? 0, unique: s.queries?.unique_domains ?? 0, cached: s.queries?.cached ?? 0, forwarded: s.queries?.forwarded ?? 0 },
    clients: { active: s.clients?.active ?? 0, total: s.clients?.total ?? 0 },
    gravity: { domains: s.gravity?.domains_being_blocked ?? 0, updated: s.gravity?.last_update ?? null },
    history: (h.history || []).map((x) => ({ at: x.timestamp, total: x.total || 0, blocked: x.blocked || 0 })),
    topBlocked: (tb.domains || []).map((d) => ({ domain: d.domain, count: d.count })),
    topPermitted: (tp.domains || []).map((d) => ({ domain: d.domain, count: d.count })),
    topClients: (tc.clients || []).map((c) => ({ name: c.name || c.ip, ip: c.ip, count: c.count })),
  };
}

export async function queries(onlyBlocked) {
  const j = await call("/queries?length=" + (onlyBlocked ? 1000 : 200));
  const rows = (j.queries || []).map((q) => ({ at: q.time, domain: q.domain, type: q.type, client: q.client?.name || q.client?.ip || "", status: q.status, blocked: BLOCKED.has(q.status) }));
  return { queries: (onlyBlocked ? rows.filter((q) => q.blocked) : rows).slice(0, 200) };
}

export async function domains() {
  const j = await call("/domains");
  return { domains: (j.domains || []).map((d) => ({ domain: d.domain, type: d.type, kind: d.kind, comment: d.comment || "", enabled: d.enabled !== false, added: d.date_added || null })) };
}

export async function setBlocking(enabled, timer) {
  if (typeof enabled !== "boolean") fail(400, "enabled must be true or false");
  const seconds = timer == null ? null : Number(timer);
  if (seconds !== null && !(Number.isInteger(seconds) && seconds >= 10 && seconds <= 86400)) fail(400, "timer must be between 10 seconds and 24 hours");
  return blocking(await call("/dns/blocking", { method: "POST", body: { blocking: enabled, timer: enabled ? null : seconds } }));
}

function entry(b) {
  const type = b?.type, kind = b?.kind, domain = typeof b?.domain === "string" ? b.domain.trim() : "";
  if (!["allow", "deny"].includes(type) || !["exact", "regex"].includes(kind)) fail(400, "Invalid list");
  if (!domain || domain.length > 255) fail(400, "Domain required (255 characters at most)");
  if (kind === "exact" && !/^[a-z0-9_*.-]+$/i.test(domain)) fail(400, "Invalid domain name");
  return { type, kind, domain };
}
export async function addDomain(b) {
  const { type, kind, domain } = entry(b);
  const comment = typeof b.comment === "string" ? b.comment.trim().slice(0, 100) : "";
  await call(`/domains/${type}/${kind}`, { method: "POST", body: { domain, comment: comment || "Added from Dokploy Plus", enabled: true } });
  return { ok: true, type, kind, domain };
}
export async function removeDomain(b) {
  const { type, kind, domain } = entry(b);
  await call(`/domains/${type}/${kind}/${encodeURIComponent(domain)}`, { method: "DELETE" });
  return { ok: true, type, kind, domain };
}
