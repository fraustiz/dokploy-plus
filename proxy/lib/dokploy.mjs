// Dokploy's own tRPC API, called with the browser's Dokploy session (never an API key), so every
// call has exactly the caller's Dokploy permissions.
export async function rpc(req, name, input, { post = false, timeout = 15000 } = {}) {
  const upstream = new URL(process.env.DOKPLOY_URL || process.env.DOKPLOY_UPSTREAM || "http://dokploy:3000");
  const url = new URL("/api/trpc/" + name, upstream);
  const host = req.headers.host || upstream.host;
  const headers = { cookie: req.headers.cookie || "", host, "x-forwarded-proto": "https" };
  const init = { headers, signal: AbortSignal.timeout(timeout) };
  if (post) Object.assign(init, { method: "POST", headers: { ...headers, "content-type": "application/json", origin: `https://${host}` }, body: JSON.stringify({ json: input }) });
  else if (input) url.searchParams.set("input", JSON.stringify({ json: input }));
  const r = await fetch(url, init);
  if (!r.ok) {
    const e = new Error(`Dokploy ${name}: HTTP ${r.status}`);
    e.status = r.status === 401 || r.status === 403 ? 403 : 502;
    throw e;
  }
  return (await r.json()).result?.data?.json;
}
