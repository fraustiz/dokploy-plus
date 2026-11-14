// One-click updates. The relay never touches Docker: it rewrites the image tags of its own Dokploy
// Compose service (Raw source) and asks Dokploy to redeploy it, with the owner's own session.
// Installs made with the docker CLI are only told which command to run.
import * as Config from "./config.mjs";
import { rpc } from "./dokploy.mjs";

const REPO = process.env.UPDATE_REPO || "fraustiz/dokploy-plus";
const API = process.env.UPDATE_API || "https://api.github.com";
const IMAGE = `ghcr.io/${REPO.toLowerCase()}`;
const SEMVER = /^\d+\.\d+\.\d+$/;
const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function newer(a, b) {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// Pin our proxy/agent images to a release; other images are left alone.
export function retag(file, version) {
  let count = 0;
  const re = new RegExp(`^(\\s*image:\\s*["']?${esc(IMAGE)}/(?:proxy|agent))(?::[\\w.-]+)?`, "gm");
  return { file: file.replace(re, (_, image) => { count++; return `${image}:v${version}`; }), count };
}

// Latest GitHub release, cached 6 h (30 min after a failure).
let release = null;
export async function latest(force = false) {
  if (process.env.UPDATE_CHECK === "off") return null;
  if (!force && release && release.until > Date.now()) return release.value;
  try {
    const r = await fetch(`${API}/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "dokploy-plus" }, redirect: "error", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`GitHub HTTP ${r.status}`);
    const j = await r.json();
    const version = String(j.tag_name || "").replace(/^v/, "");
    if (!SEMVER.test(version)) throw new Error("unexpected release tag");
    release = { until: Date.now() + 6 * 3600e3, value: { version, url: String(j.html_url || ""), notes: String(j.body || "").slice(0, 4000), publishedAt: j.published_at || null } };
  } catch (e) {
    release = { until: Date.now() + 1800e3, value: { error: `Update check failed: ${e.message}` } };
  }
  return release.value;
}

const ours = (c) => c?.sourceType === "raw" && typeof c.composeFile === "string" && retag(c.composeFile, "0.0.0").count > 0;

// Our Compose service in Dokploy: the remembered one, otherwise the first Raw compose using our image.
export async function locate(req) {
  const saved = Config.load().update?.composeId;
  if (saved) { try { const c = await rpc(req, "compose.one", { composeId: saved }); if (ours(c)) return c; } catch {} }
  const projects = await rpc(req, "project.all");
  const ids = (projects || []).flatMap((p) => (p.environments || []).flatMap((e) => (e.compose || []).map((c) => c.composeId))).filter(Boolean);
  for (let i = 0; i < ids.length; i += 4) {
    const batch = await Promise.all(ids.slice(i, i + 4).map((id) => rpc(req, "compose.one", { composeId: id }).catch(() => null)));
    const found = batch.find(ours);
    if (found) { Config.update({ update: { composeId: found.composeId } }); return found; }
  }
  return null;
}

export async function status(req, current, user, force = false) {
  const rel = await latest(force);
  const out = { current, repo: REPO, enabled: rel !== null, latest: rel?.version ? rel : null, error: rel?.error || null, available: false, managed: null };
  out.available = !!rel?.version && SEMVER.test(current) && newer(rel.version, current);
  if (out.available && user.role === "owner") {
    try { const c = await locate(req); out.managed = c ? { name: c.name } : null; } catch (e) { out.locateError = e.message; }
  }
  return out;
}

export async function apply(req, current) {
  const rel = await latest(true);
  if (!rel?.version) fail(502, rel?.error || "Update checks are disabled");
  if (SEMVER.test(current) && !newer(rel.version, current)) fail(409, `Already up to date (${current})`);
  const c = await locate(req);
  if (!c) fail(409, "This install is not a Dokploy Raw compose service: update it with docker compose.");
  const { file, count } = retag(c.composeFile, rel.version);
  if (!count) fail(409, "No Dokploy Plus image found in the compose file");
  await rpc(req, "compose.update", { composeId: c.composeId, composeFile: file }, { post: true });
  await rpc(req, "compose.deploy", { composeId: c.composeId }, { post: true });
  return { ok: true, from: current, to: rel.version, compose: c.name };
}
