// Storage alerts: polls the agent and posts to a Discord webhook when something changes.
// One message per new problem, one when it is resolved, and one each time a SMART error
// counter goes up. State is kept in /data/alerts-state.json so restarts don't re-alert.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as Config from "./config.mjs";

const STATE = path.join(process.env.DATA_DIR || "/data", "alerts-state.json");
const HEALTHY = new Set(["clean", "active", "active-idle", "write-pending", "readonly", "read-auto"]);
const ATTR = { 5: "reallocated sectors", 187: "uncorrectable errors", 197: "pending sectors", 198: "offline uncorrectable sectors", 199: "CRC errors (cable)" };

// Temperature that counts as too hot for a disk. The Settings threshold is meant for hard disks;
// SSD/NVMe run warmer and use their own reported warning limit (NVMe WCTEMP), or 70 °C.
export function tempLimit(d, hddLimit) {
  if (d.rotational !== false && !d.name?.startsWith("nvme")) return hddLimit;
  const own = d.smart?.temperature_limit_c;
  return Number.isFinite(own) && own > 0 ? own : Math.max(hddLimit, 70);
}

function problems(st, a) {
  const p = {};
  for (const r of st.arrays || []) {
    if (!HEALTHY.has(r.state)) p[`md-state:${r.name}`] = `RAID ${r.name}: state "${r.state}"`;
    if (r.degraded) p[`md-degraded:${r.name}`] = `RAID ${r.name} degraded (${r.degraded} disk(s) missing)`;
    for (const m of r.members) if (/faulty|blocked/.test(m.state || "")) p[`md-member:${r.name}:${m.dev}`] = `RAID ${r.name}: disk ${m.dev} is "${m.state}"`;
  }
  for (const v of st.volumes || []) if (v.used_pct != null && v.used_pct >= a.usagePct) p[`usage:${v.mount}`] = `${v.mount} is ${v.used_pct}% full`;
  for (const d of st.disks || []) {
    const s = d.smart || {};
    if (s.passed === false) p[`smart-failed:${d.name}`] = `Disk ${d.name} (${d.model || "?"}): SMART health check FAILED`;
    if (s.temperature_c != null && s.temperature_c >= tempLimit(d, a.tempC)) p[`temp:${d.name}`] = `Disk ${d.name} at ${s.temperature_c} °C (limit ${tempLimit(d, a.tempC)} °C)`;
    if (s.nvme?.critical_warning) p[`nvme:${d.name}`] = `NVMe ${d.name}: critical warning ${s.nvme.critical_warning}`;
  }
  return p;
}

function counters(st) {
  const c = {};
  for (const d of st.disks || []) {
    const s = d.smart || {};
    for (const [id, x] of Object.entries(s.attributes || {})) if (x.raw != null) c[`${d.name}:${id}`] = [x.raw, `Disk ${d.name}: ${ATTR[id] || id}`];
    if (s.nvme?.media_errors != null) c[`${d.name}:media`] = [s.nvme.media_errors, `NVMe ${d.name}: media errors`];
  }
  return c;
}

function loadState() {
  try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return { active: {}, counters: {} }; }
}
function saveState(s) {
  writeFileSync(`${STATE}.tmp`, JSON.stringify(s), { mode: 0o600 });
  renameSync(`${STATE}.tmp`, STATE);
}

export async function sendDiscord(url, host, lines) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "dokploy-plus" },
    body: JSON.stringify({ username: `Dokploy Plus · ${host}`, content: lines.join("\n").slice(0, 1900), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Discord HTTP ${r.status}`);
}

export async function check(fetchStatus) {
  const cfg = Config.load();
  if (!cfg.modules.storage) return;
  const st = await fetchStatus();
  const state = loadState();
  const now = problems(st, cfg.alerts);
  const lines = [];
  for (const [k, msg] of Object.entries(now)) if (!(k in state.active)) lines.push(`⚠️ ${msg}`);
  for (const [k, msg] of Object.entries(state.active)) if (!(k in now)) lines.push(`✅ Resolved: ${msg}`);
  for (const [k, [val, label]] of Object.entries(counters(st))) {
    const prev = state.counters[k] ?? 0;
    if (val > prev) lines.push(`⚠️ ${label}: ${prev} → ${val}`);
    state.counters[k] = Math.max(val, prev);
  }
  const hook = Config.secret("discordWebhook");
  if (lines.length) {
    if (hook) {
      try { await sendDiscord(hook, st.host, [`**${st.host}** — storage`, ...lines]); }
      catch (e) { console.error("[alerts]", e.message); return; } // retry next time, keep previous state
    } else console.log("[alerts] (no webhook configured)", lines.join(" | "));
  }
  state.active = now;
  saveState(state);
}

export function start(fetchStatus) {
  let timer;
  const loop = async () => {
    try { await check(fetchStatus); } catch (e) { console.error("[alerts]", e.message); }
    timer = setTimeout(loop, Math.max(1, Config.load().alerts.intervalMin) * 60_000);
    timer.unref();
  };
  setTimeout(loop, 20_000).unref(); // let the agent collect SMART first
}
