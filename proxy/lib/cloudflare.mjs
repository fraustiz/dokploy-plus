// Cloudflare API for the Dokploy Plus "Cloudflare" module.
// Token permissions: Zone > Zone > Read, Zone > DNS > Edit, Zone > Analytics > Read.
// The token is stored encrypted in the settings (see config.mjs) and never sent to the browser.
import * as Config from "./config.mjs";

const API = "https://api.cloudflare.com/client/v4";
const DNS_TYPES = new Set(["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA"]);
const PROXIABLE = new Set(["A", "AAAA", "CNAME"]);

const token = () => Config.secret("cloudflareToken");
export const cfConfigured = () => !!token();

// Check a token before saving it: must be active and able to list zones.
export async function verifyToken(t) {
  const h = { authorization: `Bearer ${t}` };
  const v = await fetch(`${API}/user/tokens/verify`, { headers: h, signal: AbortSignal.timeout(15_000) }).then((r) => r.json()).catch(() => null);
  if (!v?.success || v.result?.status !== "active") throw new CfError(400, "invalid or inactive Cloudflare token");
  const z = await fetch(`${API}/zones?per_page=50`, { headers: h, signal: AbortSignal.timeout(15_000) }).then((r) => r.json()).catch(() => null);
  if (!z?.success) throw new CfError(400, "the token cannot list zones (missing Zone > Zone > Read)");
  return { zones: z.result.map((x) => x.name) };
}

class CfError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function cf(path, { method = "GET", body } = {}) {
  const t = token();
  if (!t) throw new CfError(503, "Cloudflare token not configured (Dokploy Plus settings)");
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) {
    const msg = (j.errors || []).map((e) => e.message).join(" ; ") || `HTTP ${r.status}`;
    throw new CfError(r.status >= 400 && r.status < 500 ? r.status : 502, `Cloudflare: ${msg}`);
  }
  return j;
}

async function gql(query) {
  const j = await cf("/graphql", { method: "POST", body: { query } });
  if (j.errors?.length) throw new CfError(502, `Cloudflare: ${j.errors.map((e) => e.message).join(" ; ")}`);
  return j.data;
}

// ------------------------------------------------------------------ zones & DNS
const ID = /^[a-f0-9]{32}$/;

export async function listZones() {
  const j = await cf("/zones?per_page=50&order=name");
  return j.result.map((z) => ({
    id: z.id, name: z.name, status: z.status, paused: z.paused, plan: z.plan?.name,
    name_servers: z.name_servers, development_mode: z.development_mode,
  }));
}

export async function listDns(zone) {
  if (!ID.test(zone)) throw new CfError(400, "invalid zone");
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const j = await cf(`/zones/${zone}/dns_records?per_page=100&page=${page}&order=type`);
    out.push(...j.result);
    if (page >= (j.result_info?.total_pages || 1)) break;
  }
  return out.map((r) => ({
    id: r.id, type: r.type, name: r.name, content: r.content, proxied: r.proxied, proxiable: r.proxiable,
    ttl: r.ttl, priority: r.priority, comment: r.comment, modified_on: r.modified_on,
  }));
}

function cleanRecord(b) {
  if (!b || typeof b !== "object") throw new CfError(400, "invalid body");
  const type = String(b.type || "").toUpperCase();
  if (!DNS_TYPES.has(type)) throw new CfError(400, `unsupported type: ${type}`);
  const name = String(b.name || "").trim();
  const content = String(b.content || "").trim();
  if (!name || name.length > 255) throw new CfError(400, "invalid name");
  if (!content || content.length > 2048) throw new CfError(400, "invalid content");
  const ttl = Number(b.ttl ?? 1);
  if (!(ttl === 1 || (Number.isInteger(ttl) && ttl >= 60 && ttl <= 86400))) throw new CfError(400, "invalid TTL (auto or 60-86400 s)");
  const rec = { type, name, content, ttl };
  if (PROXIABLE.has(type)) rec.proxied = !!b.proxied;
  if (type === "MX") {
    const p = Number(b.priority ?? 10);
    if (!Number.isInteger(p) || p < 0 || p > 65535) throw new CfError(400, "invalid priority");
    rec.priority = p;
  }
  if (b.comment != null) rec.comment = String(b.comment).slice(0, 100);
  return rec;
}

export async function createDns(zone, body) {
  if (!ID.test(zone)) throw new CfError(400, "invalid zone");
  const rec = cleanRecord(body);
  return (await cf(`/zones/${zone}/dns_records`, { method: "POST", body: rec })).result;
}
export async function updateDns(zone, id, body) {
  if (!ID.test(zone) || !ID.test(id)) throw new CfError(400, "invalid id");
  const rec = cleanRecord(body);
  return (await cf(`/zones/${zone}/dns_records/${id}`, { method: "PATCH", body: rec })).result;
}
export async function deleteDns(zone, id) {
  if (!ID.test(zone) || !ID.test(id)) throw new CfError(400, "invalid id");
  return (await cf(`/zones/${zone}/dns_records/${id}`, { method: "DELETE" })).result;
}

// ------------------------------------------------------------------ statistiques
// Free plan: hourly data is kept 3 days only, daily ~1 year;
// breakdowns (devices, paths, hosts, IPs) come from httpRequestsAdaptiveGroups over 24 h.
const RANGES = { "24h": { hours: 24 }, "3d": { hours: 72 }, "7d": { days: 7 }, "30d": { days: 30 } };
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const day = (d) => d.toISOString().slice(0, 10);
const SUM = "requests bytes cachedRequests cachedBytes pageViews threats";
const MAPS = "countryMap { clientCountryName requests } responseStatusMap { edgeResponseStatus requests } contentTypeMap { edgeResponseContentTypeName requests }";

function emptyTotals() {
  return { requests: 0, bytes: 0, cachedRequests: 0, cachedBytes: 0, pageViews: 0, threats: 0, uniques: 0 };
}
function addTotals(t, g) {
  for (const k of ["requests", "bytes", "cachedRequests", "cachedBytes", "pageViews", "threats"]) t[k] += g.sum[k] || 0;
  t.uniques += g.uniq?.uniques || 0;
}
function addMaps(acc, g) {
  for (const c of g.sum.countryMap || []) acc.countries[c.clientCountryName] = (acc.countries[c.clientCountryName] || 0) + c.requests;
  for (const s of g.sum.responseStatusMap || []) {
    const k = `${String(s.edgeResponseStatus)[0]}xx`;
    acc.status[k] = (acc.status[k] || 0) + s.requests;
  }
  for (const c of g.sum.contentTypeMap || []) acc.types[c.edgeResponseContentTypeName || "autre"] = (acc.types[c.edgeResponseContentTypeName || "autre"] || 0) + c.requests;
}

async function hourly(zone, from, to) {
  // split into 3-day slices (Free plan limit)
  const out = [];
  for (let a = new Date(from); a < to; ) {
    const b = new Date(Math.min(to.getTime(), a.getTime() + 72 * 3600e3));
    const d = await gql(`{ viewer { zones(filter:{zoneTag:"${zone}"}) { httpRequests1hGroups(limit:1000,
      filter:{datetime_geq:"${iso(a)}", datetime_lt:"${iso(b)}"}, orderBy:[datetime_ASC]) {
      dimensions { t: datetime } sum { ${SUM} ${MAPS} } uniq { uniques } } } } }`);
    out.push(...(d.viewer.zones[0]?.httpRequests1hGroups || []));
    a = b;
  }
  return out;
}

async function daily(zone, from, to) {
  const d = await gql(`{ viewer { zones(filter:{zoneTag:"${zone}"}) { httpRequests1dGroups(limit:1000,
    filter:{date_geq:"${day(from)}", date_lt:"${day(to)}"}, orderBy:[date_ASC]) {
    dimensions { t: date } sum { ${SUM} ${MAPS} } uniq { uniques } } } } }`);
  return d.viewer.zones[0]?.httpRequests1dGroups || [];
}

async function topN(zone, from, to, dim, limit = 8) {
  const d = await gql(`{ viewer { zones(filter:{zoneTag:"${zone}"}) { httpRequestsAdaptiveGroups(limit:${limit},
    filter:{datetime_geq:"${iso(from)}", datetime_lt:"${iso(to)}"}, orderBy:[count_DESC]) {
    count dimensions { ${dim} } } } } }`);
  return (d.viewer.zones[0]?.httpRequestsAdaptiveGroups || []).map((g) => ({ key: g.dimensions[dim], count: g.count }));
}

const cache = new Map();
export async function analytics(zone, range) {
  if (!ID.test(zone)) throw new CfError(400, "invalid zone");
  const R = RANGES[range];
  if (!R) throw new CfError(400, "invalid range");
  const key = `${zone}:${range}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;

  const now = new Date();
  let groups, prevGroups, step;
  if (R.hours) {
    // heure pleine courante incluse
    const to = new Date(Math.ceil(now.getTime() / 3600e3) * 3600e3);
    const from = new Date(to.getTime() - R.hours * 3600e3);
    const prevFrom = new Date(from.getTime() - R.hours * 3600e3);
    step = "hour";
    if (R.hours <= 24) {
      const all = await hourly(zone, prevFrom, to);
      groups = all.filter((g) => new Date(g.dimensions.t) >= from);
      prevGroups = all.filter((g) => new Date(g.dimensions.t) < from);
    } else {
      // hourly data is kept 3 days only: previous period from daily data
      const keep = new Date(now.getTime() - 72 * 3600e3 + 5 * 60e3);
      [groups, prevGroups] = await Promise.all([
        hourly(zone, from < keep ? new Date(Math.ceil(keep.getTime() / 3600e3) * 3600e3) : from, to),
        daily(zone, prevFrom, from),
      ]);
    }
  } else {
    const to = new Date(`${day(new Date(now.getTime() + 864e5))}T00:00:00Z`);
    const from = new Date(to.getTime() - R.days * 864e5);
    const prevFrom = new Date(from.getTime() - R.days * 864e5);
    step = "day";
    const all = await daily(zone, prevFrom, to);
    groups = all.filter((g) => new Date(`${g.dimensions.t}T00:00:00Z`) >= from);
    prevGroups = all.filter((g) => new Date(`${g.dimensions.t}T00:00:00Z`) < from);
  }

  const totals = emptyTotals();
  const prev = emptyTotals();
  const acc = { countries: {}, status: {}, types: {} };
  for (const g of groups) { addTotals(totals, g); addMaps(acc, g); }
  for (const g of prevGroups) addTotals(prev, g);
  const series = groups.map((g) => ({
    t: step === "day" ? `${g.dimensions.t}T00:00:00Z` : g.dimensions.t,
    requests: g.sum.requests, cached: g.sum.cachedRequests, bytes: g.sum.bytes, uniques: g.uniq?.uniques || 0,
  }));
  const sortMap = (m, n = 10) => Object.entries(m).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, n);

  let breakdown = null;
  if (range === "24h") {
    const to = now;
    const from = new Date(now.getTime() - 24 * 3600e3);
    const dimensions = { devices: ["clientDeviceType", 5], paths: ["clientRequestPath", 12], hosts: ["clientRequestHTTPHost", 12], ips: ["clientIP", 12], browsers: ["userAgentBrowser", 10], operatingSystems: ["userAgentOS", 10], userAgents: ["userAgent", 12], httpVersions: ["clientRequestHTTPProtocol", 8], cacheStatuses: ["cacheStatus", 10], originStatuses: ["originResponseStatus", 12] };
    breakdown = { unavailable: [] };
    await Promise.all(Object.entries(dimensions).map(async ([key, [dim, limit]]) => {
      try {
        breakdown[key] = (await topN(zone, from, to, dim, limit)).map(row => ({...row, key: row.key == null || row.key === "" ? "Unknown / Others" : String(row.key)}));
      } catch {
        breakdown[key] = [];
        breakdown.unavailable.push(key);
      }
    }));
  }

  const data = {
    range, step, generated_at: now.toISOString(), totals, previous: prev, series,
    countries: sortMap(acc.countries), status: acc.status, contentTypes: sortMap(acc.types, 6), breakdown,
  };
  cache.set(key, { data, exp: Date.now() + 60_000 });
  return data;
}

export { CfError };
