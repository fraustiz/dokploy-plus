// Recent deployments of every Dokploy project (one tRPC call, caller's session) and Swarm services
// running fewer replicas than requested (from the collector).
import { rpc } from "./dokploy.mjs";

const firstLine = (v, n) => String(v || "").split("\n")[0].slice(0, n);

export function summarize(list) {
  const rows = (list || [])
    .filter((d) => (d.applicationId || d.composeId) && !d.isPreviewDeployment)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((d) => {
      const kind = d.applicationId ? "application" : "compose";
      const s = d.application || d.compose || {};
      const env = s.environment || {};
      const id = d.applicationId || d.composeId;
      return {
        id: d.deploymentId, kind, service: s.name || s.appName || "Unknown service",
        project: env.project?.name || null, environment: env.name || null,
        link: env.project?.projectId && env.environmentId ? `/dashboard/project/${encodeURIComponent(env.project.projectId)}/environment/${encodeURIComponent(env.environmentId)}/services/${kind}/${encodeURIComponent(id)}` : null,
        status: d.status, title: firstLine(d.title, 140), error: d.errorMessage ? String(d.errorMessage).slice(0, 600) : null,
        createdAt: d.createdAt, finishedAt: d.finishedAt || null,
      };
    });
  const last = new Map();
  for (const r of rows) if (!last.has(r.kind + ":" + r.link + r.service)) last.set(r.kind + ":" + r.link + r.service, r);
  return { recent: rows.slice(0, 50), failing: [...last.values()].filter((r) => r.status === "error") };
}

export async function summary(req, agent) {
  const [list, insights] = await Promise.all([
    rpc(req, "deployment.allCentralized"),
    fetch(agent + "/insights", { signal: AbortSignal.timeout(20000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  return { ...summarize(list), services: insights ? insights.services ?? null : null, checkedAt: new Date().toISOString() };
}
