// Sonarr / Radarr (API v3): releases due in the next 7 days, download queue and health issues.
// Their API key has full access to the app: only read endpoints are called.
async function get(base, path, key) {
  const r = await fetch(base.replace(/\/$/, "") + "/api/v3" + path, { headers: { "x-api-key": key, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const RELEASES = [["digitalRelease", "Digital"], ["physicalRelease", "Physical"], ["inCinemas", "In cinemas"]];

export function upcoming(kind, items, start, end) {
  return (items || []).map((e) => {
    if (kind === "sonarr") {
      const ep = `S${String(e.seasonNumber ?? 0).padStart(2, "0")}E${String(e.episodeNumber ?? 0).padStart(2, "0")}`;
      return { title: String(e.series?.title || e.title || "Episode"), detail: ep, at: e.airDateUtc || null, downloaded: !!e.hasFile };
    }
    const next = RELEASES.map(([k, label]) => ({ at: e[k] ? new Date(e[k]) : null, label })).filter((x) => x.at && x.at >= start && x.at <= end).sort((a, b) => a.at - b.at)[0];
    return { title: String(e.title || "Movie"), detail: next?.label || null, at: next?.at.toISOString() || null, downloaded: !!e.hasFile };
  }).sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

export async function summary(kind, base, key) {
  if (!key) return { online: null, configured: false };
  const start = new Date(), end = new Date(Date.now() + 7 * 864e5);
  const range = `start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;
  const [cal, queue, health] = await Promise.all([
    get(base, `/calendar?${range}${kind === "sonarr" ? "&includeSeries=true" : ""}`, key),
    get(base, "/queue/status", key),
    get(base, "/health", key),
  ]);
  const items = upcoming(kind, cal, start, end);
  return {
    online: true, configured: true, upcomingCount: items.length, upcoming: items.slice(0, 4),
    queue: { total: Number(queue?.totalCount) || 0, errors: !!queue?.errors, warnings: !!queue?.warnings },
    health: (health || []).filter((h) => h.type === "error" || h.type === "warning").slice(0, 4).map((h) => ({ type: h.type, message: String(h.message || "").slice(0, 200) })),
  };
}
