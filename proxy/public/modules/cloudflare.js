// Module « Cloudflare » : domaines, statistiques de trafic et gestion DNS.
// Balisage et classes repris des composants shadcn/ui de Dokploy v0.31.2.
import { C, ICON, icon, esc, badge, alertBlock, nf , t as tr, LANG, LOCALE } from "./ui.js";
import { mountTrafficGlobe } from "./traffic-globe.js";

const RANGES = [["24h", "24 h"], ["3d", tr("3 j","3 d")], ["7d", tr("7 j","7 d")], ["30d", tr("30 j","30 d")]];
// Palette catégorielle validée (validate_palette.js) : teintes des --chart de Dokploy, luminosité ajustée.
const PALETTE = { dark: ["#2662d9", "#d9781a", "#e23670", "#af57db"], light: ["#2563d9", "#c8650f", "#d42a64", "#9a46c9"] };
const isDark = () => document.documentElement.classList.contains("dark");
const series1 = () => (isDark() ? PALETTE.dark : PALETTE.light)[0];

const compact = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 });
const regions = new Intl.DisplayNames([LANG], { type: "region" });
const flag = (cc) => (/^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "🏳️");
const country = (cc) => { try { return regions.of(cc); } catch { return cc; } };
function bytes(n) {
  if (!n) return tr("0 o", "0 B");
  const u = LANG === "fr" ? ["o", "Ko", "Mo", "Go", "To"] : ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${nf.format(n)} ${u[i]}`;
}
function delta(cur, prev) {
  if (!prev) return "";
  const d = ((cur - prev) / prev) * 100;
  return `<span class="inline-flex items-center gap-0.5 text-xs text-muted-foreground" title="${tr("par rapport à la période précédente","compared with the previous period")}">${icon(d >= 0 ? "arrowUpRight" : "arrowDownRight", "size-3.5")}${Math.abs(d).toFixed(1)}%</span>`;
}
const DTF = {
  hour: new Intl.DateTimeFormat(LOCALE, { weekday: "short", hour: "2-digit", minute: "2-digit" }),
  day: new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" }),
  long: new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" }),
  longDay: new Intl.DateTimeFormat(LOCALE, { dateStyle: "full" }),
};

// ------------------------------------------------------------------ graphiques (SVG, sans dépendance)
function niceMax(v) {
  if (v <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = [1, 2, 2.5, 5, 10].find((m) => m * p >= v);
  return n * p;
}

// Courbe d'une seule série, avec réticule + infobulle au survol.
function lineChart(host, points, { step, height = 260, label = tr("Requêtes","Requests") }) {
  const w = Math.max(320, host.clientWidth || 800);
  const pad = { l: 44, r: 12, t: 12, b: 28 };
  const iw = w - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(...points.map((p) => p.v), 0));
  const x = (i) => pad.l + (points.length <= 1 ? iw / 2 : (i * iw) / (points.length - 1));
  const y = (v) => pad.t + ih - (v / max) * ih;
  const color = series1();
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = points.length ? `${line}L${x(points.length - 1)},${pad.t + ih}L${x(0)},${pad.t + ih}Z` : "";
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(iw / 90))));
  const fmt = step === "day" ? DTF.day : DTF.hour;
  host.innerHTML = `<div class="relative">
    <svg width="${w}" height="${height}" role="img" aria-label="${esc(label)}${tr(" dans le temps"," over time")}" style="display:block;overflow:visible">
      <defs><linearGradient id="xc-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      ${ticks.map((t) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--border)" stroke-width="1"/>
        <text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted-foreground)">${compact.format(t)}</text>`).join("")}
      ${points.map((p, i) => (i % every ? "" : `<text x="${x(i)}" y="${height - 8}" text-anchor="middle" font-size="11" fill="var(--muted-foreground)">${esc(fmt.format(new Date(p.t)))}</text>`)).join("")}
      <path d="${area}" fill="url(#xc-fill)"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <g data-x="cross" style="display:none">
        <line data-x="cl" y1="${pad.t}" y2="${pad.t + ih}" stroke="var(--muted-foreground)" stroke-width="1"/>
        <circle data-x="cd" r="4" fill="${color}" stroke="var(--card)" stroke-width="2"/>
      </g>
      <rect x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent" data-x="hit"/>
    </svg>
    <div data-x="tip" class="pointer-events-none absolute z-10 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md" style="display:none"></div>
  </div>`;
  const svg = host.querySelector("svg");
  const cross = host.querySelector('[data-x="cross"]');
  const tip = host.querySelector('[data-x="tip"]');
  const show = (ev) => {
    if (!points.length) return;
    const r = svg.getBoundingClientRect();
    const px = ev.clientX - r.left;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - pad.l) / iw) * (points.length - 1))));
    const p = points[i];
    cross.style.display = "";
    cross.querySelector('[data-x="cl"]').setAttribute("x1", x(i));
    cross.querySelector('[data-x="cl"]').setAttribute("x2", x(i));
    cross.querySelector('[data-x="cd"]').setAttribute("cx", x(i));
    cross.querySelector('[data-x="cd"]').setAttribute("cy", y(p.v));
    tip.innerHTML = `<div class="font-medium">${esc((step === "day" ? DTF.longDay : DTF.long).format(new Date(p.t)))}</div>
      <div class="mt-1 flex items-center gap-2"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color}"></span>
      ${esc(label)} <span class="font-medium">${nf.format(p.v)}</span></div>`;
    tip.style.display = "";
    const left = Math.min(w - tip.offsetWidth - 4, Math.max(0, x(i) + 12));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, y(p.v) - tip.offsetHeight - 8)}px`;
  };
  const hit = host.querySelector('[data-x="hit"]');
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerleave", () => { cross.style.display = "none"; tip.style.display = "none"; });
}

function sparkline(points, w = 220, h = 40) {
  if (points.length < 2) return "";
  const max = Math.max(...points, 1);
  const d = points.map((v, i) => `${i ? "L" : "M"}${((i * w) / (points.length - 1)).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;display:block" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${series1()}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

// Barres horizontales classées (une seule série = une seule couleur).
function rankedBars(rows, fmtKey = (k) => esc(k), attrs = () => "") {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return `<div class="flex flex-col gap-3">${rows.map((r) => `
    <div class="grid items-center gap-3 rounded-md" style="grid-template-columns:minmax(6.5rem,1fr) minmax(0,1.2fr) 3.5rem" title="${esc(r.key)} : ${nf.format(r.count)}" ${attrs(r)}>
      <span class="truncate text-sm">${fmtKey(r.key)}</span>
      <span class="h-2 w-full rounded-full bg-muted overflow-hidden"><span style="display:block;height:100%;width:${(r.count / max) * 100}%;background:${series1()};border-radius:4px"></span></span>
      <span class="text-sm font-medium tabular-nums text-right">${compact.format(r.count)}</span>
    </div>`).join("") || `<p class="text-sm text-muted-foreground">${tr("Aucune donnée.","No data.")}</p>`}</div>`;
}

// Barre segmentée (part du total), légende avec valeurs.
function segmented(entries) {
  const pal = isDark() ? PALETTE.dark : PALETTE.light;
  const total = entries.reduce((s, e) => s + e.count, 0) || 1;
  return `<div class="flex flex-col gap-3">
    <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">${entries.map((e, i) => `<span class="inline-flex items-center gap-2">
      <span style="width:10px;height:10px;border-radius:3px;background:${pal[i]}"></span>${esc(e.key)} <span class="font-medium tabular-nums">${compact.format(e.count)}</span>
      <span class="text-muted-foreground text-xs">${nf.format((e.count / total) * 100)} %</span></span>`).join("")}</div>
    <div class="flex h-8 w-full overflow-hidden rounded-md" style="gap:2px">${entries.filter((e) => e.count).map((e, i) => `
      <span title="${esc(e.key)} : ${nf.format(e.count)} (${nf.format((e.count / total) * 100)} %)" style="flex:${e.count} 1 0;min-width:3px;background:${pal[entries.indexOf(e)]}"></span>`).join("")}</div>
  </div>`;
}

// ------------------------------------------------------------------ cartes
const card = (title, body, desc = "", extra = "") => `<div data-slot="card" class="${C.card} ${extra}">
  <div data-slot="card-header" class="${C.cardHeader} pb-4"><div data-slot="card-title" class="${C.cardTitle}">${title}</div>
  ${desc ? `<div data-slot="card-description" class="text-sm text-muted-foreground">${desc}</div>` : ""}</div>
  <div data-slot="card-content" class="${C.cardContent}">${body}</div></div>`;

function statTile(label, value, d, spark) {
  return `<div data-slot="card" class="${C.card}"><div class="flex flex-col gap-2 p-6 pb-3">
    <span class="text-sm text-muted-foreground">${label}</span>
    <div class="flex items-end gap-2"><span class="text-2xl font-semibold tabular-nums">${value}</span>${d}</div></div>
    <div class="px-6 pb-4">${spark}</div></div>`;
}

function topTable(title, rows) {
  return card(title, rankedBars(rows || []));
}
function breakdownCard(b, key, title, label = key => key) {
  if (!b) return "";
  const rows=(b[key] || []).map(row=>({...row,key:label(row.key)}));
  return card(title, b.unavailable?.includes(key) ? `<p class="text-sm text-muted-foreground">This breakdown is temporarily unavailable from Cloudflare.</p>` : rankedBars(rows), "Last 24 hours");
}
// Blocs de la vue d'ensemble : ordre réglable par glisser-déposer, mémorisé dans le navigateur.
// size : kpi (1/4 de ligne), wide (ligne entière), small (1/3 de ligne).
const BLOCKS = [
  ["req", "kpi"], ["uniq", "kpi"], ["cache", "kpi"], ["bw", "kpi"],
  ["timeline", "wide"], ["countries", "wide"],
  ["status", "small"], ["devices", "small"], ["types", "small"],
  ["paths", "small"], ["hosts", "small"], ["ips", "small"],
  ["browsers", "small"], ["operatingSystems", "small"], ["userAgents", "small"],
  ["httpVersions", "small"], ["cacheStatuses", "small"], ["originStatuses", "small"],
];
const LAYOUT_KEY = "dokploy-ext:cf-layout";
const DEFAULT_ORDER = BLOCKS.map((b) => b[0]);
function loadOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "[]").filter((id) => DEFAULT_ORDER.includes(id));
    return [...saved, ...DEFAULT_ORDER.filter((id) => !saved.includes(id))];
  } catch { return [...DEFAULT_ORDER]; }
}
const BLOCK_CSS = `
.xb-grid { display:grid; gap:1rem; grid-template-columns:repeat(12,minmax(0,1fr)); }
.xb { position:relative; grid-column:span 12; min-width:0; }
.xb > [data-slot=card] { height:100%; }
@media (min-width:640px) { .xb[data-size=kpi] { grid-column:span 6; } }
@media (min-width:1024px) { .xb[data-size=kpi] { grid-column:span 3; } .xb[data-size=small] { grid-column:span 4; } }
.xb-handle { position:absolute; top:10px; right:10px; z-index:2; opacity:0; cursor:grab; transition:opacity .15s; }
.xb:hover .xb-handle, .xb-handle:focus-visible, .xb.xb-drag .xb-handle { opacity:1; }
.xb-handle:active { cursor:grabbing; }
.xb.xb-drag { opacity:.45; }
.xb.xb-over-before::before, .xb.xb-over-after::after { content:""; position:absolute; z-index:3; background:var(--primary); border-radius:2px; }
.xb[data-size=wide].xb-over-before::before { left:0; right:0; top:-9px; height:3px; }
.xb[data-size=wide].xb-over-after::after { left:0; right:0; bottom:-9px; height:3px; }
.xb:not([data-size=wide]).xb-over-before::before { top:0; bottom:0; left:-9px; width:3px; }
.xb:not([data-size=wide]).xb-over-after::after { top:0; bottom:0; right:-9px; width:3px; }
@media (prefers-reduced-motion: reduce) { .xb-handle { transition:none; } }
`;

function overview(a, zone, order) {
  const t = a.totals;
  const p = a.previous;
  const label = RANGES.find((r) => r[0] === a.range)?.[1];
  if (!t.requests)
    return alertBlock("info", tr(`<b>Aucun trafic mesuré sur ${esc(zone.name)} (${label}).</b> Cloudflare ne compte que les requêtes qui passent par son proxy : vérifie dans l'onglet DNS que les enregistrements sont « Proxifiés » (nuage orange).`, `<b>No traffic measured for ${esc(zone.name)} (${label}).</b> Cloudflare only counts requests passing through its proxy: check that DNS records are Proxied (orange cloud).`));
  const cacheRate = t.requests ? (t.cachedRequests / t.requests) * 100 : 0;
  const prevCache = p.requests ? (p.cachedRequests / p.requests) * 100 : 0;
  const s = a.series;
  const status = ["2xx", "3xx", "4xx", "5xx"].map((k) => ({ key: k, count: a.status[k] || 0 }));
  const b = a.breakdown;
  const render = {
    req: () => statTile(tr("Requêtes","Requests"), compact.format(t.requests), delta(t.requests, p.requests), sparkline(s.map((x) => x.requests))),
    uniq: () => statTile(tr("Visiteurs uniques","Unique visitors"), compact.format(t.uniques), delta(t.uniques, p.uniques), sparkline(s.map((x) => x.uniques))),
    cache: () => statTile(tr("Taux de cache","Cache hit rate"), `${nf.format(cacheRate)} %`, delta(cacheRate, prevCache), sparkline(s.map((x) => (x.requests ? x.cached / x.requests : 0)))),
    bw: () => statTile(tr("Bande passante","Bandwidth"), bytes(t.bytes), delta(t.bytes, p.bytes), sparkline(s.map((x) => x.bytes))),
    timeline: () => card(`${tr("Requêtes dans le temps","Requests over time")}`, `<div data-x="chart"></div>
      <details class="mt-4 text-sm"><summary class="cursor-pointer text-muted-foreground">${tr("Voir les données","View data")}</summary>
      <div class="${C.tableWrap} mt-2"><div class="${C.tableContainer}" style="max-height:260px;overflow:auto"><table class="${C.table}">
      <thead class="${C.thead}"><tr class="${C.tr}"><th class="${C.th}">${a.step === "day" ? tr("Jour","Day") : tr("Heure","Hour")}</th><th class="${C.th} text-right">${tr("Requêtes", "Requests")}</th><th class="${C.th} text-right">${tr("En cache","Cached")}</th><th class="${C.th} text-right">${tr("Visiteurs","Visitors")}</th></tr></thead>
      <tbody class="${C.tbody}">${s.map((x) => `<tr class="${C.tr}"><td class="${C.td}">${esc((a.step === "day" ? DTF.day : DTF.long).format(new Date(x.t)))}</td>
        <td class="${C.td} text-right tabular-nums">${nf.format(x.requests)}</td><td class="${C.td} text-right tabular-nums">${nf.format(x.cached)}</td><td class="${C.td} text-right tabular-nums">${nf.format(x.uniques)}</td></tr>`).join("")}</tbody></table></div></div></details>`,
      `${compact.format(t.requests)}${tr(" requêtes · "," requests · ")}${compact.format(t.pageViews)}${tr(" pages vues · "," page views · ")}${nf.format(t.threats)}${tr(" menaces bloquées"," threats blocked")}`),
    countries: () => card(tr("Requêtes par pays","Requests by country"), `<div class="grid items-center gap-6" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
        <div class="flex items-center justify-center"><div style="width:100%;max-width:340px;aspect-ratio:1">
          <canvas data-x="globe" style="width:100%;height:100%" aria-label="${tr("Globe des requêtes par pays","Requests by country globe")}" role="img"></canvas></div></div>
        <div data-x="countries">${rankedBars(a.countries, (k) => `${flag(k)} ${esc(country(k))}`, (r) => `data-cc="${esc(r.key)}"`)}</div>
      </div>`, tr("Survole un pays pour le voir sur le globe ; fais glisser le globe pour le tourner.","Hover over a country to locate it on the globe; drag the globe to rotate it.")),
    status: () => card(tr("Codes de réponse","Response codes"), segmented(status)),
    devices: () => (b?.devices?.length ? card(tr("Appareils","Devices"), rankedBars(b.devices, (k) => esc({ desktop: tr("Ordinateur","Desktop"), mobile: "Mobile", tablet: tr("Tablette","Tablet") }[k] || k)), tr("Dernières 24 h","Last 24 hours")) : ""),
    types: () => card(tr("Types de contenu","Content types"), rankedBars(a.contentTypes)),
    paths: () => (b ? topTable(tr("Chemins les plus demandés","Top paths"), b.paths, tr("Chemin","Path")) : ""),
    hosts: () => (b ? topTable(tr("Hôtes","Hosts"), b.hosts, tr("Hôte","Host")) : ""),
    browsers: () => breakdownCard(b, "browsers", "Top browsers"),
    operatingSystems: () => breakdownCard(b, "operatingSystems", "Top operating systems"),
    userAgents: () => breakdownCard(b, "userAgents", "Top user agents"),
    httpVersions: () => breakdownCard(b, "httpVersions", "Top HTTP versions"),
    cacheStatuses: () => breakdownCard(b, "cacheStatuses", "Top cache statuses", key => key === "Unknown / Others" ? "None" : key.charAt(0).toUpperCase() + key.slice(1)),
    originStatuses: () => breakdownCard(b, "originStatuses", "Top origin status codes", key => key === "0" ? "None" : ({"200":"200 OK","301":"301 Moved Permanently","302":"302 Found","304":"304 Not Modified","307":"307 Temporary Redirect","308":"308 Permanent Redirect","400":"400 Bad Request","401":"401 Unauthorized","403":"403 Forbidden","404":"404 Not Found","500":"500 Internal Server Error","502":"502 Bad Gateway","503":"503 Service Unavailable"}[key] || key)),
    ips: () => (b ? topTable(tr("Adresses IP","IP addresses"), b.ips, "IP") : ""),
  };
  const size = Object.fromEntries(BLOCKS);
  const blocks = order.map((id) => {
    const html = render[id]?.();
    if (!html) return "";
    return `<div class="xb" data-block="${id}" data-size="${size[id]}">
      <button type="button" class="xb-handle ${C.btnGhostIcon}" draggable="true" data-handle="${id}"
        aria-label="${tr("Déplacer le bloc (glisser, ou flèches du clavier)","Move block (drag or use arrow keys)")}" title="${tr("Glisser pour déplacer","Drag to move")}">${icon("grip")}</button>${html}</div>`;
  }).join("");
  return `<div class="flex flex-col gap-4"><div class="xb-grid" data-x="blocks">${blocks}</div>
    ${b ? "" : `<p class="text-xs text-muted-foreground">${tr("Chemins, hôtes, IP et appareils : disponibles sur la période « 24 h » (limite de l'offre Free).","Detailed breakdowns are available for the 24-hour period. Switch to 24 h to see browsers, operating systems, user agents, HTTP versions, cache and origin status.")}</p>`}</div>`;
}

// ------------------------------------------------------------------ DNS
const TTLS = [[1, "Auto"], [60, "1 min"], [300, "5 min"], [1800, "30 min"], [3600, "1 h"], [86400, tr("1 j","1 d")]];
const TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA"];
const CONTENT_LABEL = { A: tr("Adresse IPv4","IPv4 address"), AAAA: tr("Adresse IPv6","IPv6 address"), CNAME: tr("Cible","Target"), TXT: tr("Contenu","Content"), MX: tr("Serveur de messagerie","Mail server"), NS: tr("Serveur de noms","Name server"), SRV: tr("Contenu (priorité poids port cible)","Content (priority weight port target)"), CAA: tr("Contenu (flags tag valeur)","Content (flags tag value)") };
const ttlLabel = (t) => TTLS.find((x) => x[0] === t)?.[1] || `${nf.format(t)} s`;
const relName = (name, zone) => (name === zone ? "@" : name.endsWith(`.${zone}`) ? name.slice(0, -zone.length - 1) : name);

function dnsTable(records, zone, q) {
  const f = q.trim().toLowerCase();
  const rows = records.filter((r) => !f || `${r.type} ${r.name} ${r.content}`.toLowerCase().includes(f));
  return `<div class="${C.tableWrap}"><div class="${C.tableContainer}"><table class="${C.table}">
    <thead class="${C.thead}"><tr class="${C.tr}">${["Type", tr("Nom","Name"), tr("Contenu","Content"), "Proxy", "TTL", ""].map((h) => `<th class="${C.th}">${h}</th>`).join("")}</tr></thead>
    <tbody class="${C.tbody}">${rows.map((r) => `<tr class="${C.tr}">
      <td class="${C.td}">${badge("blank", esc(r.type))}</td>
      <td class="${C.td} font-mono text-xs"><span class="font-medium">${esc(relName(r.name, zone.name))}</span>${r.name !== zone.name ? `<span class="text-muted-foreground">.${esc(zone.name)}</span>` : ""}</td>
      <td class="${C.td} font-mono text-xs max-w-md truncate" title="${esc(r.content)}">${r.priority != null && r.type === "MX" ? `<span class="text-muted-foreground">${r.priority} </span>` : ""}${esc(r.content)}${r.comment ? `<div class="font-sans text-muted-foreground truncate">${esc(r.comment)}</div>` : ""}</td>
      <td class="${C.td}">${r.proxiable ? (r.proxied ? badge("orange", `${icon("cloud", "size-3")}${tr(" Proxifié"," Proxied")}`) : badge("blank", tr("DNS uniquement","DNS only"))) : `<span class="text-muted-foreground">—</span>`}</td>
      <td class="${C.td} text-muted-foreground">${ttlLabel(r.ttl)}</td>
      <td class="${C.td} text-right"><div class="inline-flex gap-1">
        <button type="button" class="${C.btnGhostIcon}" data-act="edit" data-id="${r.id}" title="${tr("Modifier","Edit")}">${icon("pencil")}</button>
        <button type="button" class="${C.btnGhostIcon} text-destructive" data-act="delete" data-id="${r.id}" title="${tr("Supprimer","Delete")}">${icon("trash")}</button></div></td>
    </tr>`).join("") || `<tr><td colspan="6" class="${C.td} text-center text-muted-foreground">Aucun enregistrement.</td></tr>`}</tbody></table></div></div>
    <p class="mt-2 text-xs text-muted-foreground">${rows.length} enregistrement(s)${f ? ` sur ${records.length}` : ""}.</p>`;
}

function recordDialog(rec, zone) {
  const r = rec || { type: "A", name: "", content: "", ttl: 1, proxied: true, priority: 10, comment: "" };
  return `<div data-slot="dialog-overlay" class="${C.overlay}" data-x="close"></div>
  <form data-slot="dialog-content" class="${C.dialog}" data-x="form" role="dialog" aria-modal="true">
    <div data-slot="dialog-header" class="flex flex-col gap-2">
      <div data-slot="dialog-title" class="text-base leading-none font-medium">${rec ? tr("Modifier l'enregistrement", "Edit record") : tr("Ajouter un enregistrement","Add record")}</div>
      <div data-slot="dialog-description" class="text-sm text-muted-foreground">Zone ${esc(zone.name)}</div></div>
    <div class="grid gap-4">
      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-2"><label class="${C.label}" for="xr-type">Type</label>
          <select id="xr-type" name="type" class="${C.select}" ${rec ? "disabled" : ""}>${TYPES.map((t) => `<option ${t === r.type ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="flex flex-col gap-2"><label class="${C.label}" for="xr-ttl">TTL</label>
          <select id="xr-ttl" name="ttl" class="${C.select}">${TTLS.map(([v, l]) => `<option value="${v}" ${v === r.ttl ? "selected" : ""}>${l}</option>`).join("")}${TTLS.some((x) => x[0] === r.ttl) ? "" : `<option value="${r.ttl}" selected>${r.ttl} s</option>`}</select></div>
      </div>
      <div class="flex flex-col gap-2"><label class="${C.label}" for="xr-name">${tr("Nom", "Name")}</label>
        <input id="xr-name" name="name" class="${C.input} font-mono" value="${esc(rec ? relName(r.name, zone.name) : "")}" placeholder="${tr("@ ou sous-domaine","@ or subdomain")}" required autocomplete="off">
        <span class="text-xs text-muted-foreground">${tr("« @ » pour ","“@” for ")}${esc(zone.name)}${tr(", sinon le sous-domaine (ex. : app).",", otherwise the subdomain (e.g. app).")}</span></div>
      <div class="flex flex-col gap-2"><label class="${C.label}" for="xr-content" data-x="content-label">${CONTENT_LABEL[r.type]}</label>
        <input id="xr-content" name="content" class="${C.input} font-mono" value="${esc(r.content)}" required autocomplete="off"></div>
      <div class="flex flex-col gap-2" data-x="prio" ${r.type === "MX" ? "" : "hidden"}><label class="${C.label}" for="xr-prio">${tr("Priorité","Priority")}</label>
        <input id="xr-prio" name="priority" type="number" min="0" max="65535" class="${C.input}" value="${esc(r.priority ?? 10)}"></div>
      <div class="flex items-center justify-between rounded-lg border p-3" data-x="proxy" ${["A", "AAAA", "CNAME"].includes(r.type) ? "" : "hidden"}>
        <div class="flex flex-col gap-1"><span class="${C.label}">${tr("Proxy Cloudflare","Cloudflare proxy")}</span><span class="text-xs text-muted-foreground">${tr("Masque l'IP, met en cache et compte le trafic.","Hides the IP, caches content and measures traffic.")}</span></div>
        <button type="button" role="switch" aria-checked="${!!r.proxied}" data-size="default" data-state="${r.proxied ? "checked" : "unchecked"}" ${r.proxied ? "data-checked" : "data-unchecked"} class="${C.switch}" data-x="proxied">
          <span class="${C.switchThumb}" ${r.proxied ? "data-checked" : "data-unchecked"} data-state="${r.proxied ? "checked" : "unchecked"}"></span></button></div>
      <div class="flex flex-col gap-2"><label class="${C.label}" for="xr-comment">${tr("Commentaire ","Comment ")}<span class="text-muted-foreground font-normal">${tr("(facultatif)","(optional)")}</span></label>
        <input id="xr-comment" name="comment" maxlength="100" class="${C.input}" value="${esc(r.comment || "")}"></div>
      <div data-x="err"></div>
    </div>
    <div data-slot="dialog-footer" class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button type="button" class="${C.btnOutline}" data-x="close">${tr("Annuler","Cancel")}</button>
      <button type="submit" class="${C.btnPrimary}" data-x="submit">${rec ? tr("Enregistrer","Save") : tr("Ajouter","Add")}</button></div>
  </form>`;
}

function confirmDialog(r, zone) {
  return `<div data-slot="alert-dialog-overlay" class="${C.overlay}" data-x="close"></div>
  <div data-slot="alert-dialog-content" class="${C.alertDialog}" role="alertdialog" aria-modal="true">
    <div class="grid gap-2 text-left">
      <div class="font-heading text-lg font-medium">${tr("Supprimer cet enregistrement ?","Delete this record?")}</div>
      <div class="text-sm text-muted-foreground">${esc(r.type)} <span class="font-mono">${esc(r.name)}</span> → <span class="font-mono break-all">${esc(r.content)}</span><br>
      ${tr("Cette action est immédiate sur ","This takes effect immediately on ")}${esc(zone.name)}${tr(" et ne peut pas être annulée."," and cannot be undone.")}</div></div>
    <div data-x="err"></div>
    <div class="-mx-6 -mb-6 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-6 sm:flex-row sm:justify-end">
      <button type="button" class="${C.btnOutline}" data-x="close">${tr("Annuler","Cancel")}</button>
      <button type="button" class="${C.btnDestructive}" data-x="confirm">${tr("Supprimer","Delete")}</button></div>
  </div>`;
}

// ------------------------------------------------------------------ montage
export function mount(root, { api }) {
  const st = { order: loadOrder(), zones: [], zone: null, tab: "overview", range: "24h", a: null, dns: null, q: "", loading: false, err: null };
  const call = async (path, opt = {}) => {
    const r = await api(path, opt);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };
  const write = (path, method, body) =>
    call(path, { method, headers: { "content-type": "application/json", "x-ext-csrf": "1" }, body: body ? JSON.stringify(body) : undefined });

  root.innerHTML = `<style>${BLOCK_CSS}</style><div class="${C.page}"><div data-slot="card" class="${C.outer}"><div class="${C.inner}">
    <div data-slot="card-header" class="${C.header}">
      <div data-slot="card-title" class="${C.title}">${icon("cloud", C.titleIcon)}Cloudflare</div>
      <div data-slot="card-description" class="${C.desc}" data-x="sub">${tr("Chargement…","Loading…")}</div>
      <div data-slot="card-action" class="${C.action}"><select class="${C.select} min-w-48" data-x="zone" aria-label="${tr("Domaine","Domain")}"></select></div>
    </div>
    <div data-slot="card-content" class="${C.content}">
      <div class="flex flex-wrap items-center gap-2">
        <div role="tablist" data-slot="tabs-list" data-variant="default" class="${C.tabsList}">
          <button type="button" role="tab" data-slot="tabs-trigger" class="${C.tab}" data-tab="overview">${icon("chart")}${tr("Vue d'ensemble","Overview")}</button>
          <button type="button" role="tab" data-slot="tabs-trigger" class="${C.tab}" data-tab="dns">${icon("globe")}DNS</button>
        </div>
        <div class="ml-auto flex flex-wrap items-center gap-2" data-x="tools"></div>
      </div>
      <div data-x="body" class="pt-4"></div>
    </div></div></div></div>
    <div data-x="modal"></div><div data-x="toast" class="fixed right-4 bottom-4 z-50 flex flex-col gap-2"></div>`;
  const $ = (k) => root.querySelector(`[data-x="${k}"]`);
  let alive = true;
  let globe = null;
  const dropGlobe = () => { try { globe?.destroy(); } catch {} globe = null; };

  function toast(msg, bad = false) {
    const t = document.createElement("div");
    t.className = `rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-md ${bad ? "text-destructive" : ""}`;
    t.textContent = msg;
    $("toast").appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  function renderTools() {
    if (st.tab === "overview") {
      $("tools").innerHTML = `<div role="tablist" data-slot="tabs-list" data-variant="default" class="${C.tabsList}">${RANGES.map(([k, l]) =>
        `<button type="button" role="tab" data-slot="tabs-trigger" class="${C.tab}" data-range="${k}" ${st.range === k ? "data-active aria-selected=\"true\"" : ""}>${l}</button>`).join("")}</div>
        ${st.order.join() !== DEFAULT_ORDER.join() ? `<button type="button" class="${C.btnOutlineIcon}" data-x="reset-layout" title="${tr("Disposition par défaut","Default layout")}" aria-label="${tr("Revenir à la disposition par défaut","Reset layout")}">${icon("reset")}</button>` : ""}
        <button type="button" class="${C.btnOutlineIcon}" data-x="refresh" title="${tr("Actualiser","Refresh")}">${icon("refresh", st.loading ? "animate-spin" : "")}</button>`;
    } else {
      $("tools").innerHTML = `<input class="${C.input}" style="width:16rem" placeholder="${tr("Rechercher…","Search…")}" data-x="q" value="${esc(st.q)}" aria-label="${tr("Rechercher un enregistrement","Search records")}">
        <button type="button" class="${C.btnPrimary}" data-x="add">${icon("plus")}${tr("Ajouter", "Add")}</button>`;
    }
    root.querySelectorAll("[data-tab]").forEach((b) => {
      const on = b.dataset.tab === st.tab;
      b.toggleAttribute("data-active", on);
      b.setAttribute("aria-selected", on);
    });
  }

  function renderBody() {
    const body = $("body");
    dropGlobe();
    if (st.err) { body.innerHTML = alertBlock("error", esc(st.err)); return; }
    if (st.tab === "overview") {
      if (!st.a) { body.innerHTML = skeleton(); return; }
      body.innerHTML = overview(st.a, st.zone, st.order);
      const ch = body.querySelector('[data-x="chart"]');
      if (ch) lineChart(ch, st.a.series.map((s) => ({ t: s.t, v: s.requests })), { step: st.a.step });
      const cv = body.querySelector('[data-x="globe"]');
      if (cv) {
        globe = mountTrafficGlobe(cv, st.a.countries.map((c) => ({ code: c.key, requests: c.count })), isDark());
        const list = body.querySelector('[data-x="countries"]');
        list.addEventListener("pointerover", (e) => { const r = e.target.closest("[data-cc]"); if (r) globe?.focus(r.dataset.cc); });
        list.addEventListener("pointerleave", () => globe?.resume());
      }
    } else {
      if (!st.dns) { body.innerHTML = skeleton(); return; }
      body.innerHTML = dnsTable(st.dns, st.zone, st.q);
    }
  }
  const skeleton = () => `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">${'<div class="animate-pulse rounded-md bg-muted h-32"></div>'.repeat(4)}</div>
    <div class="animate-pulse rounded-md bg-muted h-72 mt-4"></div>`;

  function renderHeader() {
    const z = st.zone;
    $("sub").innerHTML = z
      ? `${badge(z.status === "active" ? "green" : "yellow", esc(z.status))} <span class="ml-1">${esc(z.plan || "")} · ${st.zones.length}${tr(" domaine(s)"," domain(s)")}${st.a ? `${tr(" · mis à jour "," · updated ")}${new Date(st.a.generated_at).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })}` : ""}</span>`
      : tr("Aucun domaine","No domains");
  }

  async function load() {
    if (!st.zone) return;
    st.loading = true; st.err = null; renderTools();
    try {
      if (st.tab === "overview") st.a = await call(`/cf/zones/${st.zone.id}/analytics?range=${st.range}`);
      else st.dns = await call(`/cf/zones/${st.zone.id}/dns`);
    } catch (e) { st.err = e.message; }
    st.loading = false;
    if (!alive) return;
    renderHeader(); renderTools(); renderBody();
  }

  // ---------------- interactions
  root.addEventListener("click", async (e) => {
    const t = e.target.closest("button, [data-x='close']");
    if (!t) return;
    if (t.dataset.tab && t.dataset.tab !== st.tab) { st.tab = t.dataset.tab; renderTools(); renderBody(); load(); }
    else if (t.dataset.range && t.dataset.range !== st.range) { st.range = t.dataset.range; st.a = null; renderTools(); renderBody(); load(); }
    else if (t.dataset.x === "refresh") load();
    else if (t.dataset.x === "reset-layout") { setOrder([...DEFAULT_ORDER]); }
    else if (t.dataset.x === "add") openRecord(null);
    else if (t.dataset.act === "edit") openRecord(st.dns.find((r) => r.id === t.dataset.id));
    else if (t.dataset.act === "delete") openDelete(st.dns.find((r) => r.id === t.dataset.id));
    else if (t.dataset.x === "close") closeModal();
    else if (t.dataset.x === "proxied") {
      const on = t.getAttribute("aria-checked") !== "true";
      t.setAttribute("aria-checked", on);
      for (const el of [t, t.firstElementChild]) {
        el.dataset.state = on ? "checked" : "unchecked";
        el.toggleAttribute("data-checked", on);
        el.toggleAttribute("data-unchecked", !on);
      }
    }
  });
  root.addEventListener("input", (e) => {
    if (e.target.dataset.x === "q") {
      st.q = e.target.value;
      $("body").innerHTML = dnsTable(st.dns || [], st.zone, st.q);
    }
  });
  root.addEventListener("change", (e) => {
    if (e.target.dataset.x === "zone") {
      st.zone = st.zones.find((z) => z.id === e.target.value);
      st.a = null; st.dns = null; st.q = "";
      localStorage.setItem("dokploy-ext:cf-zone", st.zone.id);
      renderHeader(); renderTools(); renderBody(); load();
    }
  });
  // ---------------- blocs déplaçables (glisser-déposer + clavier)
  function setOrder(order, focusId) {
    st.order = order;
    if (order.join() === DEFAULT_ORDER.join()) localStorage.removeItem(LAYOUT_KEY);
    else localStorage.setItem(LAYOUT_KEY, JSON.stringify(order));
    renderTools(); renderBody();
    if (focusId) root.querySelector(`[data-handle="${focusId}"]`)?.focus();
  }
  function moveBlock(id, targetId, after) {
    if (id === targetId) return;
    const o = st.order.filter((x) => x !== id);
    o.splice(o.indexOf(targetId) + (after ? 1 : 0), 0, id);
    setOrder(o);
  }
  let dragId = null;
  const clearOver = () => root.querySelectorAll(".xb-over-before, .xb-over-after").forEach((e) => e.classList.remove("xb-over-before", "xb-over-after"));
  const sideOf = (el, e) => {
    const r = el.getBoundingClientRect();
    return el.dataset.size === "wide" ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
  };
  root.addEventListener("dragstart", (e) => {
    const h = e.target.closest?.("[data-handle]");
    if (!h) return;
    dragId = h.dataset.handle;
    const blk = h.closest(".xb");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragId);
    e.dataTransfer.setDragImage(blk, blk.offsetWidth - 24, 24);
    requestAnimationFrame(() => blk.classList.add("xb-drag"));
  });
  root.addEventListener("dragover", (e) => {
    if (!dragId) return;
    const el = e.target.closest?.(".xb");
    if (!el) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    clearOver();
    if (el.dataset.block !== dragId) el.classList.add(sideOf(el, e) ? "xb-over-after" : "xb-over-before");
  });
  root.addEventListener("drop", (e) => {
    if (!dragId) return;
    const el = e.target.closest?.(".xb");
    e.preventDefault();
    const id = dragId;
    dragId = null;
    clearOver();
    if (el && el.dataset.block !== id) moveBlock(id, el.dataset.block, sideOf(el, e));
    else root.querySelector(".xb-drag")?.classList.remove("xb-drag");
  });
  root.addEventListener("dragend", () => {
    dragId = null;
    clearOver();
    root.querySelectorAll(".xb-drag").forEach((e) => e.classList.remove("xb-drag"));
  });
  root.addEventListener("keydown", (e) => {
    const h = e.target.closest?.("[data-handle]");
    if (!h) return;
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
    if (!back && !fwd) return;
    e.preventDefault();
    // ordre des blocs réellement affichés (certains n'existent pas hors 24 h)
    const shown = [...root.querySelectorAll(".xb")].map((x) => x.dataset.block);
    const i = shown.indexOf(h.dataset.handle);
    const j = i + (fwd ? 1 : -1);
    if (j < 0 || j >= shown.length) return;
    const o = st.order.filter((x) => x !== shown[i]);
    o.splice(o.indexOf(shown[j]) + (fwd ? 1 : 0), 0, shown[i]);
    setOrder(o, shown[i]);
  });

  const onKey = (e) => { if (e.key === "Escape") closeModal(); };
  document.addEventListener("keydown", onKey);

  function closeModal() { $("modal").innerHTML = ""; }

  function openRecord(rec) {
    $("modal").innerHTML = recordDialog(rec, st.zone);
    const f = $("modal").querySelector("form");
    const type = f.elements.type;
    const sync = () => {
      const t = type.value;
      f.querySelector('[data-x="content-label"]').textContent = CONTENT_LABEL[t];
      f.querySelector('[data-x="prio"]').hidden = t !== "MX";
      f.querySelector('[data-x="proxy"]').hidden = !["A", "AAAA", "CNAME"].includes(t);
    };
    type.addEventListener("change", sync);
    f.elements.name.focus();
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const n = f.elements.name.value.trim();
      const body = {
        type: type.value,
        name: n === "@" || n === "" ? st.zone.name : n.endsWith(st.zone.name) ? n : `${n}.${st.zone.name}`,
        content: f.elements.content.value.trim(),
        ttl: Number(f.elements.ttl.value),
        proxied: f.querySelector('[data-x="proxied"]').getAttribute("aria-checked") === "true",
        priority: Number(f.elements.priority.value),
        comment: f.elements.comment.value.trim(),
      };
      const btn = f.querySelector('[data-x="submit"]');
      btn.disabled = true;
      try {
        if (rec) await write(`/cf/zones/${st.zone.id}/dns/${rec.id}`, "PUT", body);
        else await write(`/cf/zones/${st.zone.id}/dns`, "POST", body);
        closeModal();
        toast(rec ? tr("Enregistrement modifié.","Record updated.") : tr("Enregistrement ajouté.","Record added."));
        st.dns = null; renderBody(); load();
      } catch (err) {
        f.querySelector('[data-x="err"]').innerHTML = alertBlock("error", esc(err.message));
        btn.disabled = false;
      }
    });
  }

  function openDelete(rec) {
    $("modal").innerHTML = confirmDialog(rec, st.zone);
    const box = $("modal");
    box.querySelector('[data-x="confirm"]').focus();
    box.querySelector('[data-x="confirm"]').onclick = async (e) => {
      e.currentTarget.disabled = true;
      try {
        await write(`/cf/zones/${st.zone.id}/dns/${rec.id}`, "DELETE");
        closeModal();
        toast(tr("Enregistrement supprimé.","Record deleted."));
        st.dns = null; renderBody(); load();
      } catch (err) {
        box.querySelector('[data-x="err"]').innerHTML = alertBlock("error", esc(err.message));
        e.currentTarget.disabled = false;
      }
    };
  }

  // redessine le graphique quand la largeur change
  let rt;
  const ro = new ResizeObserver(() => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const ch = root.querySelector('[data-x="chart"]');
      if (ch && st.a && st.tab === "overview") lineChart(ch, st.a.series.map((s) => ({ t: s.t, v: s.requests })), { step: st.a.step });
    }, 150);
  });
  ro.observe(root);
  // thème clair/sombre : couleurs des séries recalculées
  const mo = new MutationObserver(() => renderBody());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  (async () => {
    renderTools(); renderBody();
    try {
      st.zones = await call("/cf/zones");
      const saved = localStorage.getItem("dokploy-ext:cf-zone");
      st.zone = st.zones.find((z) => z.id === saved) || null;
      if (!st.zone) {
        // premier passage : le premier domaine qui a du trafic sur 24 h
        for (const z of st.zones) {
          try {
            const a = await call(`/cf/zones/${z.id}/analytics?range=24h`);
            if (a.totals.requests > 0) { st.zone = z; st.a = a; break; }
          } catch {}
        }
        st.zone ??= st.zones[0] || null;
      }
      $("zone").innerHTML = st.zones.map((z) => `<option value="${z.id}" ${z === st.zone ? "selected" : ""}>${esc(z.name)}</option>`).join("");
      renderHeader();
      await load();
    } catch (e) { st.err = e.message; renderBody(); $("sub").textContent = tr("Erreur","Error"); }
  })();
  const timer = setInterval(() => { if (st.tab === "overview" && !$("modal").innerHTML) load(); }, 5 * 60_000);

  return () => { alive = false; dropGlobe(); clearInterval(timer); ro.disconnect(); mo.disconnect(); document.removeEventListener("keydown", onKey); };
}
