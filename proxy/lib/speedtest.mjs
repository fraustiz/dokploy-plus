// Speedtest Tracker (API v1) with a token limited to results:read: latest result and recent history.
export async function summary(base, token) {
  if (!token) return { online: null, configured: false };
  const r = await fetch(base.replace(/\/$/, "") + "/api/v1/results?sort=-created_at&page%5Bsize%5D=30", { headers: { authorization: "Bearer " + token, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const rows = ((await r.json()).data || []).filter((x) => x.status === "completed").map((x) => ({
    at: x.created_at || null, downloadBps: Number(x.download_bits) || null, uploadBps: Number(x.upload_bits) || null, pingMs: Number(x.ping) || null,
  }));
  return { online: true, configured: true, latest: rows[0] || null, history: rows.reverse() };
}
