// Module « Stockage / RAID » (lecture seule).
import { C, icon, esc, nf, badge, alertBlock , t as tr, LANG, LOCALE } from "./ui.js";
// Rendu dans le DOM de Dokploy avec le balisage et les classes de ses composants shadcn/ui
// (Card, Badge, Button, Table, Progress, AlertBlock) : même apparence que les pages natives.
const REFRESH_MS = 30_000;

// ------------------------------------------------------------------ helpers
function bytes(n) {
  if (n == null) return "—";
  const u = LANG === "fr" ? ["o", "Ko", "Mo", "Go", "To", "Po"] : ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${nf.format(n)} ${u[i]}`;
}
function hours(h) {
  if (h == null) return "—";
  const y = h / 8766;
  return y >= 1 ? `${nf.format(h)} h (${nf.format(y)} ${tr("an", "year")}${y >= 2 ? "s" : ""})` : `${nf.format(h)} h`;
}
const ago = (t) => {
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return new Intl.RelativeTimeFormat(LOCALE, { numeric: "always" }).format(-(s < 60 ? s : Math.round(s / 60)), s < 60 ? "second" : "minute");
};
const progress = (pct) =>
  `<div data-slot="progress" class="${C.progress}"><div data-slot="progress-indicator" class="${C.progressBar}" style="transform: translateX(-${100 - Math.min(100, pct)}%)"></div></div>`;
const HEALTHY = new Set(["clean", "active", "active-idle", "write-pending", "readonly", "read-auto"]);
const LEVEL = { raid0: "RAID 0", raid1: "RAID 1", raid4: "RAID 4", raid5: "RAID 5", raid6: "RAID 6", raid10: "RAID 10", linear: tr("Linéaire","Linear") };
const LVL_TXT = { ok: "OK", warn: tr("À surveiller","Warning"), bad: tr("Erreur","Error"), idle: tr("Veille","Standby") };
const LVL_BADGE = { ok: "green", warn: "orange", bad: "red", idle: "blank" };

// État d'un disque : ok | warn | bad | idle
function diskLevel(d, st) {
  const th = st.thresholds || { temperature_c: 55 };
  const s = d.smart || {};
  const faulty = st.arrays.some((a) => a.members.some((m) => m.dev.startsWith(d.name) && /faulty|blocked/.test(m.state || "")));
  if (faulty || s.passed === false || s.nvme?.critical_warning) return { lvl: "bad", why: faulty ? tr("exclu du RAID","removed from RAID") : tr("SMART en échec","SMART failed") };
  if (!s.available) return { lvl: "idle", why: d.standby || s.standby ? tr("en veille","in standby") : tr("SMART illisible","SMART unavailable") };
  const why = Object.values(s.attributes || {}).filter((a) => a.raw > 0).map((a) => `${a.label} : ${a.raw}`);
  if (s.nvme?.media_errors > 0) why.push(`${tr("erreurs média : ","media errors: ")}${s.nvme.media_errors}`);
  if (s.temperature_c != null && s.temperature_c >= (d.temperature_alert_c ?? th.temperature_c) - 8) why.push(`${tr("chaud : ","hot: ")}${s.temperature_c} °C`);
  return why.length ? { lvl: "warn", why: why.join(" · ") } : { lvl: "ok", why: tr("aucune erreur","no errors") };
}

// ------------------------------------------------------------------ visuel du boîtier (CSS propre, préfixé)
const NAS_CSS = `
.xn { display:flex; flex-direction:column; align-items:center; gap:20px; padding:8px 0 4px; }
.xn-case { --m: color-mix(in oklab, var(--foreground) 9%, var(--card)); position:relative; display:flex; gap:18px;
  padding:16px 18px 16px 14px; margin-bottom:6px; border-radius:14px;
  background: linear-gradient(180deg, color-mix(in oklab, var(--foreground) 15%, var(--card)) 0%, var(--m) 7%, color-mix(in oklab, black 16%, var(--m)) 100%);
  border:1px solid color-mix(in oklab, var(--foreground) 14%, transparent);
  box-shadow: 0 1px 0 color-mix(in oklab, white 10%, transparent) inset, 0 16px 28px -18px rgb(0 0 0 / .6); }
.xn-case::after { content:""; position:absolute; left:24px; right:24px; bottom:-6px; height:6px; border-radius:0 0 6px 6px;
  background: color-mix(in oklab, black 35%, var(--m)); }
.xn-panel { display:flex; flex-direction:column; justify-content:space-between; align-items:center; width:58px; padding:2px 0; }
.xn-brand { writing-mode:vertical-rl; transform:rotate(180deg); font-size:11px; font-weight:600; letter-spacing:.32em;
  text-transform:uppercase; color: var(--muted-foreground); }
.xn-leds { display:flex; flex-direction:column; gap:9px; font-size:10px; color: var(--muted-foreground); }
.xn-leds span { display:flex; align-items:center; gap:6px; }
.xn-power { width:26px; height:26px; border-radius:50%; display:grid; place-items:center;
  background: radial-gradient(circle at 35% 30%, color-mix(in oklab, white 16%, var(--m)), color-mix(in oklab, black 25%, var(--m)));
  border:1px solid color-mix(in oklab, var(--foreground) 16%, transparent); }
.xn-power svg { width:13px; height:13px; color:#22c55e; filter: drop-shadow(0 0 3px rgb(34 197 94 / .8)); }
.xn-bays { display:flex; gap:10px; padding:10px; border-radius:9px; background: color-mix(in oklab, black 38%, var(--m));
  box-shadow: 0 2px 6px rgb(0 0 0 / .45) inset; }
.xn-bay { all:unset; box-sizing:border-box; cursor:pointer; position:relative; width:76px; height:200px; border-radius:6px;
  padding:10px 8px 8px; display:flex; flex-direction:column; align-items:center; gap:7px;
  background: linear-gradient(180deg, color-mix(in oklab, var(--foreground) 11%, var(--m)), color-mix(in oklab, black 10%, var(--m)));
  border:1px solid color-mix(in oklab, var(--foreground) 13%, transparent); transition: box-shadow .15s, border-color .15s; }
.xn-bay:hover { border-color: color-mix(in oklab, var(--foreground) 30%, transparent); }
.xn-bay:focus-visible, .xn-m2:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
.xn-bay.sel, .xn-m2.sel { box-shadow: 0 0 0 2px var(--primary); }
.xn-grille { flex:1; width:100%; border-radius:3px; opacity:.85;
  background: radial-gradient(circle, rgb(0 0 0 / .55) 1.3px, transparent 1.6px) 0 0 / 7px 7px; }
.xn-notch { width:34px; height:5px; border-radius:3px; background: color-mix(in oklab, black 40%, var(--m)); }
.xn-name { font: 600 12px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--foreground); }
.xn-sub { font-size:10px; line-height:1.3; color: var(--muted-foreground); text-align:center; }
.xn-num { position:absolute; top:8px; left:9px; font-size:9px; color: var(--muted-foreground); }
.xn-act { position:absolute; top:10px; right:9px; width:5px; height:5px; border-radius:50%; background:#38bdf8;
  box-shadow: 0 0 4px #38bdf8; animation: xn-act 2.6s infinite; }
.xn-bay:nth-child(2) .xn-act { animation-delay:.9s } .xn-bay:nth-child(3) .xn-act { animation-delay:1.7s }
.xn-led { display:inline-block; width:8px; height:8px; border-radius:50%; flex:none; background:#71717a; box-shadow: 0 0 0 1px rgb(0 0 0 / .3); }
.xn-led.ok { background:#22c55e; box-shadow: 0 0 6px 1px rgb(34 197 94 / .7); }
.xn-led.warn { background:#f59e0b; box-shadow: 0 0 6px 1px rgb(245 158 11 / .75); }
.xn-led.bad { background:#ef4444; box-shadow: 0 0 8px 2px rgb(239 68 68 / .8); animation: xn-blink 1s steps(2, start) infinite; }
.xn-led.static { animation:none; box-shadow:none; }
@keyframes xn-blink { to { visibility:hidden } }
@keyframes xn-act { 0%,60%,100% { opacity:.15 } 62%,66% { opacity:1 } 64% { opacity:.3 } }
@media (prefers-reduced-motion: reduce) { .xn-led.bad, .xn-act { animation:none } }
.xn-m2 { all:unset; box-sizing:border-box; cursor:pointer; display:flex; align-items:center; gap:16px; padding:12px 16px;
  border-radius: var(--radius); border:1px solid var(--border); background: var(--card); max-width:100%; }
.xn-m2:hover { border-color: color-mix(in oklab, var(--foreground) 25%, transparent); }
.xn-m2 svg { flex:none; width:260px; height:auto; max-width:45vw; }
.xn-legend { display:flex; flex-wrap:wrap; justify-content:center; gap:6px 16px; font-size:12px; color: var(--muted-foreground); }
.xn-legend span { display:inline-flex; align-items:center; gap:6px; }
tr.xn-sel { background: var(--muted); }
`;

// Barrette M.2 2280 (22 × 80 mm) dessinée en SVG
function m2Svg(lvl) {
  const fingers = Array.from({ length: 30 }, (_, i) => {
    const y = 6 + i * 1.83;
    if (y > 41.5 && y < 46) return ""; // détrompeur M-key
    return `<rect x="1.2" y="${y.toFixed(2)}" width="5.2" height="1.1" rx=".3" fill="#d4a63c"/>`;
  }).join("");
  const led = { ok: "#22c55e", warn: "#f59e0b", bad: "#ef4444", idle: "#71717a" }[lvl];
  return `<svg viewBox="0 0 250 66" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${tr("Barrette M.2 2280","M.2 2280 module")}">
    <defs><linearGradient id="xn-pcb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f6b45"/><stop offset="1" stop-color="#14492f"/></linearGradient></defs>
    <path d="M6 1H238a5 5 0 0 1 5 5V27a6 6 0 0 0 0 12V60a5 5 0 0 1-5 5H6a5 5 0 0 1-5-5V6a5 5 0 0 1 5-5z" fill="url(#xn-pcb)" stroke="#0d3320" stroke-width="1"/>
    ${fingers}
    <rect x="1" y="41" width="5" height="4" fill="var(--card)"/>
    <circle cx="243" cy="33" r="5.6" fill="none" stroke="#d4a63c" stroke-width="2.2"/>
    <g stroke="#2f8a5c" stroke-width=".6" opacity=".55" fill="none">
      <path d="M8 14h14l6 6h8"/><path d="M8 24h20l4 4h4"/><path d="M8 50h16l6-6h6"/><path d="M8 58h22"/>
      <path d="M78 33h12"/><path d="M152 33h12"/>
    </g>
    <rect x="34" y="14" width="40" height="38" rx="2.5" fill="#18181b"/>
    <rect x="37" y="17" width="34" height="32" rx="1.5" fill="none" stroke="#3f3f46" stroke-width=".8"/>
    <text x="54" y="36" font-size="6.5" font-family="ui-monospace,monospace" fill="#71717a" text-anchor="middle">CTRL</text>
    <rect x="92" y="10" width="56" height="46" rx="2.5" fill="#18181b"/>
    <rect x="164" y="10" width="56" height="46" rx="2.5" fill="#18181b"/>
    <text x="120" y="36" font-size="6.5" font-family="ui-monospace,monospace" fill="#71717a" text-anchor="middle">NAND</text>
    <text x="192" y="36" font-size="6.5" font-family="ui-monospace,monospace" fill="#71717a" text-anchor="middle">NAND</text>
    <rect x="93" y="58.5" width="10" height="3" rx=".6" fill="#a1a1aa"/><rect x="108" y="58.5" width="6" height="3" rx=".6" fill="#a1a1aa"/>
    <circle cx="224" cy="58" r="2.6" fill="${led}"${lvl === "idle" ? "" : ` style="filter:drop-shadow(0 0 2px ${led})"`}/>
  </svg>`;
}

function nas(st) {
  const sata = st.disks.filter((d) => !d.name.startsWith("nvme"));
  const nvme = st.disks.filter((d) => d.name.startsWith("nvme"));
  const raidBad = st.arrays.some((a) => !HEALTHY.has(a.state) || a.degraded);
  const raidLvl = raidBad ? "bad" : st.arrays.length ? (st.arrays.every((a) => a.redundant) ? "ok" : "warn") : "idle";
  const lv = st.disks.map((d) => diskLevel(d, st).lvl);
  const sysLvl = lv.includes("bad") ? "bad" : lv.includes("warn") ? "warn" : "ok";
  const bays = sata.map((d, i) => {
    const { lvl, why } = diskLevel(d, st);
    const s = d.smart || {};
    const tip = `${d.name} · ${s.model || d.model || ""} · ${bytes(d.size_bytes)}\n${LVL_TXT[lvl]} : ${why}${d.arrays.length ? `\nRAID : ${d.arrays.join(", ")}` : ""}`;
    return `<button type="button" class="xn-bay" data-disk="${esc(d.name)}" title="${esc(tip)}" aria-label="${esc(tip)}">
      <span class="xn-num">${i + 1}</span><span class="xn-led ${lvl}"></span>${lvl === "idle" ? "" : `<span class="xn-act"></span>`}
      <span class="xn-grille"></span><span class="xn-notch"></span>
      <span class="xn-name">${esc(d.name)}</span>
      <span class="xn-sub">${bytes(d.size_bytes)}${s.temperature_c != null ? `<br>${s.temperature_c} °C` : ""}</span></button>`;
  }).join("");
  const m2 = nvme.map((d) => {
    const { lvl, why } = diskLevel(d, st);
    const s = d.smart || {};
    return `<button type="button" class="xn-m2" data-disk="${esc(d.name)}" title="${esc(`${d.name} · ${LVL_TXT[lvl]} : ${why}`)}">
      ${m2Svg(lvl)}
      <span class="flex flex-col gap-1 text-left">
        <span class="flex items-center gap-2"><span class="font-medium text-foreground">${esc(d.name)}</span>${badge(LVL_BADGE[lvl], LVL_TXT[lvl])}</span>
        <span class="${C.small}">M.2 NVMe · ${bytes(d.size_bytes)}${s.temperature_c != null ? ` · ${s.temperature_c} °C` : ""}</span>
        ${s.nvme ? `<span class="${C.small}">${tr("usure ","wear ")}${s.nvme.percentage_used}${tr(" % · réserve "," % · spare ")}${s.nvme.available_spare} %</span>` : ""}
      </span></button>`;
  }).join("");
  return `<div class="xn">
    ${sata.length ? `<div class="xn-case">
      <div class="xn-panel">
        <span class="xn-brand">${esc(st.host)}</span>
        <span class="xn-leds"><span><i class="xn-led ${sysLvl}"></i>${tr("Disques", "Disks")}</span><span><i class="xn-led ${raidLvl}"></i>RAID</span></span>
        <span class="xn-power">${icon("power")}</span>
      </div>
      <div class="xn-bays">${bays}</div>
    </div>` : ""}
    ${m2}
    <div class="xn-legend">${["ok", "warn", "bad", "idle"].map((l) => `<span><i class="xn-led ${l} static"></i>${LVL_TXT[l]}</span>`).join("")}</div>
  </div>`;
}

// ------------------------------------------------------------------ sections
function attr(d, id) {
  const a = d.smart?.attributes?.[id];
  if (!a || a.raw == null) return `<span class="${C.muted}">—</span>`;
  return a.raw > 0 ? badge(id === "199" ? "orange" : "red", nf.format(a.raw)) : "0";
}

function arrayCard(a, st) {
  const th = st.thresholds || { usage_pct: 90 };
  const healthy = HEALTHY.has(a.state) && !a.degraded;
  const syncing = a.sync?.action && a.sync.action !== "idle";
  const vols = st.volumes.filter((v) => v.device === a.name);
  const stat = (k, v) => `<div class="flex flex-col gap-1"><span class="${C.small}">${k}</span><span class="font-medium">${v}</span></div>`;
  return `<div data-slot="card" class="${C.card}">
    <div data-slot="card-header" class="${C.cardHeader}">
      <div data-slot="card-title" class="${C.cardTitle} flex flex-row flex-wrap items-center gap-2">
        <span class="font-mono">/dev/${esc(a.name)}</span>
        ${badge("blank", esc(LEVEL[a.level] || a.level))}
        ${healthy ? (syncing ? badge("yellow", esc(a.sync.action)) : badge("green", `${tr("sain (","healthy (")}${esc(a.state)})`)) : badge("red", esc(a.degraded ? tr("dégradé","degraded") : a.state))}
        ${a.redundant ? badge("green", tr("redondant","redundant")) : badge("orange", tr("sans redondance","no redundancy"))}
      </div>
    </div>
    <div data-slot="card-content" class="${C.cardContent} flex flex-col gap-6">
      <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
        ${stat(tr("Capacité","Capacity"), bytes(a.size_bytes))}
        ${stat(tr("Disques","Disks"), `${a.members.length} / ${a.raid_disks}`)}
        ${stat(tr("Taille de bande","Chunk size"), a.chunk_bytes ? bytes(a.chunk_bytes) : "—")}
        ${a.redundant ? stat(tr("Incohérences","Mismatches"), a.mismatch_cnt ?? "—") : ""}
      </div>
      ${vols.map((v) => volume(v, th.usage_pct)).join("")}
      ${syncing && a.sync.progress != null ? `<div class="flex flex-col gap-2"><span class="${C.small}">${esc(a.sync.action)} : ${nf.format(a.sync.progress)} %</span>${progress(a.sync.progress)}</div>` : ""}
      <div class="flex flex-col gap-2"><span class="${C.small}">${tr("Membres","Members")}</span>
        <div class="flex flex-wrap gap-2">${a.members.map((m) => {
          const bad = /faulty|blocked/.test(m.state || "");
          return badge(bad ? "red" : m.errors ? "orange" : "outline", `${esc(m.dev)} · ${esc(m.state)} · slot ${esc(m.slot)}${m.errors ? ` · ${m.errors}${tr(" erreurs"," errors")}` : ""}`);
        }).join("")}</div></div>
      <details class="text-sm"><summary class="cursor-pointer ${C.muted}">${tr("Détail mdadm","mdadm details")}</summary>
        <pre class="mt-2 overflow-auto rounded-md border bg-muted/50 p-4 font-mono text-xs">${esc(a.detail)}</pre></details>
    </div></div>`;
}

function volume(v, threshold) {
  if (v.error) return `<span class="${C.small}">${esc(v.mount)} : ${esc(v.error)}</span>`;
  return `<div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="font-medium font-mono">${esc(v.mount)}</span>
      <span class="${C.muted}">${bytes(v.used_bytes)} / ${bytes(v.size_bytes)} · ${bytes(v.avail_bytes)}${tr(" libres"," free")}
        ${v.used_pct >= threshold ? badge("red", `${nf.format(v.used_pct)} %`) : v.used_pct >= threshold - 10 ? badge("orange", `${nf.format(v.used_pct)} %`) : badge("blank", `${nf.format(v.used_pct)} %`)}</span>
    </div>${progress(v.used_pct)}</div>`;
}

function disksTable(st) {
  const th = st.thresholds || { temperature_c: 55 };
  const head = [tr("Disque","Disk"), tr("Modèle","Model"), tr("Taille","Size"), "RAID", tr("Santé","Health"), "Temp.", tr("Utilisation","Power-on time"), tr("Réalloués","Reallocated"), tr("En attente","Pending"), tr("Irrécup.","Uncorrectable"), "CRC", tr("Dernier autotest","Last self-test")];
  const rows = st.disks.map((d) => {
    const s = d.smart || {};
    const { lvl, why } = diskLevel(d, st);
    const type = d.name.startsWith("nvme") ? "NVMe" : d.rotational ? "HDD" : "SSD";
    const nv = s.nvme;
    const t = s.temperature_c;
    const lim = d.temperature_alert_c ?? th.temperature_c;
    const tBadge = t == null ? "—" : `<span title="Alert at ${lim} °C">${badge(t >= lim ? "red" : t >= lim - 8 ? "orange" : "blank", `${t} °C`)}</span>`;
    const na = `<span class="${C.muted}">n/a</span>`;
    const test = s.self_test
      ? `<div class="flex flex-col"><span>${esc(s.self_test.type)} · ${s.self_test.passed === false ? `<span class="text-destructive">${esc(s.self_test.status)}</span>` : esc(s.self_test.status)}</span>${
          s.power_on_hours != null && s.self_test.lifetime_hours != null ? `<span class="${C.small}">${tr("il y a", "ago:")} ${hours(s.power_on_hours - s.self_test.lifetime_hours)}</span>` : ""}</div>`
      : `<span class="${C.muted}">${tr("aucun","none")}</span>`;
    return `<tr data-slot="table-row" class="${C.tr}" data-disk="${esc(d.name)}">
      <td class="${C.td}"><div class="flex flex-col"><span class="font-medium font-mono">${esc(d.name)}</span><span class="${C.small}">${type}</span></div></td>
      <td class="${C.td}"><div class="flex flex-col"><span>${esc(s.model || d.model || "—")}</span><span class="${C.small}">${esc(s.serial || "")}</span></div></td>
      <td class="${C.td}">${bytes(d.size_bytes)}</td>
      <td class="${C.td}">${d.arrays.length ? d.arrays.map(esc).join(", ") : `<span class="${C.muted}">—</span>`}</td>
      <td class="${C.td}"><div class="flex flex-col gap-1">${badge(LVL_BADGE[lvl], LVL_TXT[lvl])}${lvl !== "ok" ? `<span class="${C.small}">${esc(why)}</span>` : nv ? `<span class="${C.small}">${tr("usure ","wear ")}${nv.percentage_used} %</span>` : ""}</div></td>
      <td class="${C.td}">${tBadge}</td>
      <td class="${C.td}">${hours(s.power_on_hours)}</td>
      <td class="${C.td}">${nv ? na : attr(d, "5")}</td>
      <td class="${C.td}">${nv ? na : attr(d, "197")}</td>
      <td class="${C.td}">${nv ? (nv.media_errors ? badge("red", nv.media_errors) : "0") : attr(d, "198")}</td>
      <td class="${C.td}">${nv ? na : attr(d, "199")}</td>
      <td class="${C.td}">${test}</td></tr>`;
  }).join("");
  return `<div class="${C.tableWrap}"><div data-slot="table-container" class="${C.tableContainer}"><table data-slot="table" class="${C.table}">
    <thead data-slot="table-header" class="${C.thead}"><tr data-slot="table-row" class="${C.tr}">${head.map((h) => `<th data-slot="table-head" class="${C.th}">${h}</th>`).join("")}</tr></thead>
    <tbody data-slot="table-body" class="${C.tbody}">${rows}</tbody></table></div></div>`;
}

const section = (title, desc, body) => `<div class="flex flex-col gap-4">
  <div class="flex flex-col gap-1"><h3 class="text-base font-medium">${title}</h3>${desc ? `<p class="text-sm text-muted-foreground">${desc}</p>` : ""}</div>${body}</div>`;

function resources(st) {
  const m = st.memory;
  const memory = m ? section(tr("Mémoire et swap","Memory and swap"), "", `<p class="${C.muted}">RAM : ${bytes(m.used_bytes)} / ${bytes(m.total_bytes)} — Swap : ${bytes(m.swap_used_bytes)} / ${bytes(m.swap_total_bytes)}</p>`) : "";
  const docker = st.docker ? section("Docker", tr("Lecture seule : aucun nettoyage automatique.","Read-only: no automatic cleanup."), `<div class="flex flex-col gap-2">${Object.entries(st.docker).filter(([, v]) => v && typeof v === "object").map(([k, v]) => `<p>${esc(({ images: tr("Images", "Images"), containers: tr("Conteneurs", "Containers"), volumes: "Volumes", build_cache: tr("Cache de compilation", "Build cache") })[k] || k)} : ${bytes(v.size_bytes)} (${bytes(v.reclaimable_bytes)}${tr(" récupérables"," reclaimable")})</p>`).join("")}</div>`) : "";
  return memory + docker;
}

function render(st) {
  const th = st.thresholds || { usage_pct: 90, temperature_c: 55 };
  const alerts = [];
  for (const a of st.arrays) {
    if (!HEALTHY.has(a.state) || a.degraded)
      alerts.push(alertBlock("error", `<b>${esc(a.name)}${tr(" : état « "," : state “")}${esc(a.state)}${tr(" »"," ”")}${a.degraded ? `, ${a.degraded}${tr(" disque(s) manquant(s)"," missing disk(s)")}` : ""}.</b> ${tr("Ne redémarre pas et n'écris plus sur le volume avant d'avoir identifié le disque en cause.","Do not reboot or write to this volume before identifying the affected disk.")}`));
    else if (!a.redundant)
      alerts.push(alertBlock("warning", `<b>${esc(a.name)}${tr(" est en "," uses ")}${esc(LEVEL[a.level] || a.level)}${tr(" : aucune redondance.",": no redundancy.")}</b> ${tr("Si un seul des ","If any one of the ")}${a.raid_disks}${tr(" disques lâche, tout le volume est perdu. Garde une sauvegarde ailleurs. Toute migration demande une sauvegarde et une procédure adaptée."," disks fails, the entire volume is lost. Keep an external backup. Any migration requires a backup and an appropriate procedure.")}`));
  }
  for (const d of st.disks)
    if (d.smart?.passed === false) alerts.push(alertBlock("error", `<b>${tr("Disque", "Disk")} ${esc(d.name)}${tr(" : test SMART échoué.",": SMART test failed.")}</b> ${tr("Le disque annonce sa propre panne. Sauvegarde les données maintenant.","The disk reports a failure. Back up the data now.")}`));

  const others = st.volumes.filter((v) => !st.arrays.some((a) => a.name === v.device));
  return `<div class="flex flex-col gap-8">
    ${st.mode === "hardware" ? nas(st) : ""}
    ${alerts.length ? `<div class="flex flex-col gap-2">${alerts.join("")}</div>` : ""}
    ${section("RAID", tr("Grappes mdadm détectées sur le serveur.","mdadm arrays detected on this server."), st.arrays.map((a) => arrayCard(a, st)).join("") || `<p class="${C.muted}">${tr("Aucun RAID mdadm détecté.","No mdadm RAID detected.")}</p>`)}
    ${resources(st)}
    ${st.mode === "hardware" ? section(tr("Disques","Disks"), tr("Santé SMART lue toutes les 5 minutes, sans réveiller un disque en veille.","SMART health checked every 5 minutes without waking sleeping disks."), disksTable(st)) : ""}
    ${others.length ? section(tr("Autres volumes","Other volumes"), "", `<div class="flex flex-col gap-4">${others.map((v) => volume(v, th.usage_pct)).join("")}</div>`) : ""}
    ${alertBlock("info", `${tr("Lecture seule. Alertes Discord ","Read-only. Discord alerts ")}${st.alerts?.discord ? `${tr("activées (intervalle ","enabled (interval ")}${st.alerts.intervalMin} min)` : tr("désactivées", "disabled")}${tr(" : RAID dégradé, disque en échec, compteurs SMART en hausse, température ≥ ",": degraded RAID, failed disks, rising SMART counters, hard disk temperature ≥ ")}${th.temperature_c} °C (SSD/NVMe: their own limit)${tr(", volume ≥ ",", volume ≥ ")}${th.usage_pct} %.`)}
  </div>`;
}

// ------------------------------------------------------------------ montage
export function mount(root, { api }) {
  root.innerHTML = `<style>${NAS_CSS}</style>
  <div class="${C.page}"><div data-slot="card" class="${C.outer}"><div class="${C.inner}">
    <div data-slot="card-header" class="${C.header}">
      <div data-slot="card-title" class="${C.title}">${icon("hardDrive", C.titleIcon)}${tr("Stockage / RAID","Storage / RAID")}</div>
      <div data-slot="card-description" class="${C.desc}" data-x="sub">${tr("Chargement…","Loading…")}</div>
      <div data-slot="card-action" class="${C.action}">
        <button type="button" data-slot="button" class="${C.btnOutlineSm}" data-x="refresh">${icon("refresh", "size-4")}${tr("Actualiser","Refresh")}</button></div>
    </div>
    <div data-slot="card-content" class="${C.content}" data-x="body"></div>
  </div></div></div>`;
  const $ = (k) => root.querySelector(`[data-x="${k}"]`);
  let last = null;
  let alive = true;
  let sel = null;

  function highlight() {
    root.querySelectorAll("[data-disk]").forEach((e) => {
      const on = e.dataset.disk === sel;
      e.classList.toggle(e.tagName === "TR" ? "xn-sel" : "sel", on);
    });
  }
  root.addEventListener("click", (e) => {
    const b = e.target.closest?.(".xn-bay[data-disk], .xn-m2[data-disk]");
    if (!b) return;
    sel = sel === b.dataset.disk ? null : b.dataset.disk;
    highlight();
    if (sel) root.querySelector(`tr[data-disk="${CSS.escape(sel)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  async function load() {
    const btn = $("refresh");
    btn.querySelector("svg")?.classList.add("animate-spin");
    try {
      const r = await api("/storage/status");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (!alive) return;
      j.mode ??= j.arrays?.length || j.disks?.some(d => d.smart?.available) ? "hardware" : "virtual";
      last = j;
      $("body").innerHTML = render(j);
      highlight();
    } catch (e) {
      if (alive) $("body").innerHTML = alertBlock("error", `${tr("Impossible de lire l'état du stockage : ","Unable to read storage status: ")}${esc(e.message)}`);
    }
    btn.querySelector("svg")?.classList.remove("animate-spin");
    tick();
  }
  function tick() {
    if (alive) $("sub").textContent = last ? `${last.host}${tr(" · mis à jour "," · updated ")}${ago(last.collected_at)}` : "—";
  }
  $("refresh").onclick = load;
  load();
  const t1 = setInterval(load, REFRESH_MS);
  const t2 = setInterval(tick, 5000);
  return () => { alive = false; clearInterval(t1); clearInterval(t2); };
}
