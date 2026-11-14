import { C, esc, icon, nf, badge, alertBlock, LOCALE } from './ui.js';

const CSS = `
.xp { color:var(--foreground); }
.xp-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr)); gap:14px; }
.xp-card { padding:20px; border:1px solid var(--border); border-radius:12px; background:var(--card); min-width:0; display:flex; flex-direction:column; gap:14px; }
.xp-card h3 { font-size:15px; font-weight:600; }
.xp-sub { color:var(--muted-foreground); font-size:12px; line-height:1.6; }
.xp-tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:14px; }
.xp-tile { padding:16px 18px; border:1px solid var(--border); border-radius:12px; background:var(--card); }
.xp-tile dt { color:var(--muted-foreground); font-size:12px; margin-bottom:6px; }
.xp-tile dd { font-size:22px; font-weight:600; font-variant-numeric:tabular-nums; }
.xp-state { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; }
.xp-state strong { font-size:17px; }
.xp-actions { display:flex; flex-wrap:wrap; gap:8px; }
.xp-rows { display:flex; flex-direction:column; }
.xp-row { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border); font-size:13px; min-width:0; }
.xp-row:last-child { border-bottom:0; }
.xp-row .xp-domain { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.xp-row .xp-n { color:var(--muted-foreground); font-variant-numeric:tabular-nums; font-size:12px; }
.xp-row button { font-size:12px; text-decoration:underline; color:var(--muted-foreground); cursor:pointer; white-space:nowrap; }
.xp-row button:hover { color:var(--foreground); }
.xp-toggle { display:flex; gap:4px; padding:3px; background:var(--muted); border-radius:8px; width:fit-content; }
.xp-toggle button { padding:5px 10px; border-radius:6px; font-size:12px; color:var(--muted-foreground); cursor:pointer; }
.xp-toggle button[aria-pressed=true] { background:var(--background); color:var(--foreground); }
.xp-form { display:grid; grid-template-columns:minmax(0,2fr) repeat(2,minmax(0,1fr)) auto; gap:8px; align-items:end; }
.xp-legend { display:flex; gap:16px; font-size:12px; color:var(--muted-foreground); }
.xp-legend i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:6px; vertical-align:-1px; }
@media(max-width:640px) { .xp-form { grid-template-columns:1fr 1fr; } }
`;
const PAUSES = [[300, '5 min'], [1800, '30 min'], [3600, '1 h']];
const clock = (s) => new Date(s * 1000).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });

// 24 h of 10-minute buckets: all queries (muted) with blocked queries drawn over them.
export function chart(history) {
  if (history.length < 2) return `<p class="xp-sub">Collecting data…</p>`;
  const max = Math.max(...history.map((h) => h.total), 1), w = 600 / history.length;
  const bars = history.map((h, i) => {
    const x = (i * w).toFixed(2), bw = Math.max(w - 0.6, 0.4).toFixed(2);
    const th = (h.total / max * 100).toFixed(2), bh = (h.blocked / max * 100).toFixed(2);
    return `<rect x="${x}" y="${(100 - th).toFixed(2)}" width="${bw}" height="${th}" fill="var(--muted-foreground)" opacity=".25"/><rect x="${x}" y="${(100 - bh).toFixed(2)}" width="${bw}" height="${bh}" fill="var(--primary)"><title>${clock(h.at)}: ${h.blocked} of ${h.total} blocked</title></rect>`;
  }).join('');
  return `<svg viewBox="0 0 600 100" preserveAspectRatio="none" role="img" aria-label="Queries over the last 24 hours" style="width:100%;height:140px">${bars}</svg>
  <div class="flex justify-between xp-sub"><span>${clock(history[0].at)}</span><span>Peak: ${nf.format(max)} queries / 10 min</span><span>${clock(history.at(-1).at)}</span></div>
  <div class="xp-legend"><span><i style="background:var(--muted-foreground);opacity:.35"></i>All queries</span><span><i style="background:var(--primary)"></i>Blocked</span></div>`;
}

export function mount(root, { api }) {
  let alive = true, data = null, lists = null, log = null, onlyBlocked = true;
  const headers = { 'content-type': 'application/json', 'x-ext-csrf': '1' };
  const req = async (path, options) => { const r = await api('/pihole/' + path, options); const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
  const send = (path, method, body) => req(path, { method, headers, body: JSON.stringify(body) });
  root.innerHTML = `<style>${CSS}</style><div class="${C.page} xp"><div class="${C.outer}"><div class="${C.inner}"><div class="${C.header}"><h2 class="${C.title}">Pi-hole</h2><p class="${C.desc}">Network-wide DNS blocking: status, statistics, query log and domain lists.</p><div class="${C.action}"><button class="${C.btnOutlineSm}" data-refresh>${icon('refresh', 'size-4')}Refresh</button></div></div><div class="${C.content} flex flex-col gap-6"><p role="status" class="xp-sub" data-say></p><div data-body class="flex flex-col gap-6">Loading…</div></div></div></div></div>`;
  const body = root.querySelector('[data-body]');
  const say = (t) => { if (alive) root.querySelector('[data-say]').textContent = t; };

  const domainRows = (rows, action) => rows.length ? `<div class="xp-rows">${rows.map((d) => `<div class="xp-row"><span class="xp-domain" title="${esc(d.domain)}">${esc(d.domain)}</span><span class="xp-n">${nf.format(d.count)}</span><button type="button" data-act="${action}" data-domain="${esc(d.domain)}">${action === 'allow' ? 'Allow' : 'Block'}</button></div>`).join('')}</div>` : `<p class="xp-sub">Nothing yet today.</p>`;

  function blockingCard() {
    const b = data.blocking, on = b.state === 'enabled';
    const state = on ? 'Blocking is on' : b.state === 'disabled' ? `Blocking is paused${b.timer ? ` — back on in ${Math.ceil(b.timer / 60)} min` : ' until you turn it back on'}` : `Blocking state: ${esc(b.state)}`;
    const actions = on
      ? `${PAUSES.map(([s, label]) => `<button type="button" class="${C.btnOutlineSm}" data-act="pause" data-seconds="${s}">Pause ${label}</button>`).join('')}<button type="button" class="${C.btnOutlineSm}" data-act="disable">Turn off</button>`
      : `<button type="button" class="${C.btnPrimary}" data-act="enable">Turn blocking back on</button>`;
    return `<div class="xp-card"><div class="xp-state"><div class="flex items-center gap-3">${badge(on ? 'green' : 'orange', on ? 'Active' : 'Paused')}<strong>${state}</strong></div><div class="xp-actions">${actions}</div></div></div>`;
  }

  // Overview part only: refreshed every 30 s without touching the query log or the list form.
  function overview() {
    const q = data.queries;
    return `${blockingCard()}
    <dl class="xp-tiles">
      <div class="xp-tile"><dt>Queries today</dt><dd>${nf.format(q.total)}</dd></div>
      <div class="xp-tile"><dt>Blocked</dt><dd>${nf.format(q.blocked)} <span class="xp-sub">${nf.format(q.percent)}%</span></dd></div>
      <div class="xp-tile"><dt>Domains on blocklists</dt><dd>${nf.format(data.gravity.domains)}</dd></div>
      <div class="xp-tile"><dt>Active clients</dt><dd>${nf.format(data.clients.active)} <span class="xp-sub">of ${nf.format(data.clients.total)}</span></dd></div>
    </dl>
    <div class="xp-card"><h3>Last 24 hours</h3>${chart(data.history)}</div>
    <div class="xp-grid">
      <div class="xp-card"><div><h3>Most blocked today</h3><p class="xp-sub">Something broken? Allow its domain.</p></div>${domainRows(data.topBlocked, 'allow')}</div>
      <div class="xp-card"><div><h3>Most allowed today</h3><p class="xp-sub">Block a domain for the whole network.</p></div>${domainRows(data.topPermitted, 'block')}</div>
      <div class="xp-card"><h3>Top clients</h3><div class="xp-rows">${data.topClients.map((c) => `<div class="xp-row"><span class="xp-domain">${esc(c.name)}${c.name !== c.ip ? ` <span class="xp-sub">${esc(c.ip)}</span>` : ''}</span><span class="xp-n">${nf.format(c.count)}</span></div>`).join('') || '<p class="xp-sub">No clients yet.</p>'}</div></div>
    </div>
    <p class="xp-sub">Blocklists last updated ${data.gravity.updated ? esc(new Date(data.gravity.updated * 1000).toLocaleString(LOCALE)) : 'never'}. Changes are made with Pi-hole's application password and apply to the whole network immediately.</p>`;
  }
  function render() {
    body.innerHTML = `<div class="flex flex-col gap-6" data-overview>${overview()}</div><div class="xp-card" data-log></div><div class="xp-card" data-lists></div>`;
    renderLog(); renderLists();
  }

  function renderLog() {
    const box = root.querySelector('[data-log]'); if (!box) return;
    const rows = log?.queries || [];
    box.innerHTML = `<div class="xp-state"><div><h3>Recent queries</h3><p class="xp-sub">Most recent first, up to 200.</p></div><div class="xp-toggle" role="group" aria-label="Filter queries"><button type="button" data-act="log" data-blocked="1" aria-pressed="${onlyBlocked}">Blocked</button><button type="button" data-act="log" data-blocked="0" aria-pressed="${!onlyBlocked}">All</button></div></div>
    ${!log ? '<p class="xp-sub">Loading…</p>' : rows.length ? `<div class="xp-rows" style="max-height:420px;overflow:auto">${rows.map((r) => `<div class="xp-row"><span class="xp-n">${esc(clock(r.at))}</span><span class="xp-domain" title="${esc(r.domain)}">${esc(r.domain)}</span><span class="xp-n">${esc(r.client)}</span>${r.blocked ? `${badge('red', 'Blocked')}<button type="button" data-act="allow" data-domain="${esc(r.domain)}">Allow</button>` : `<span class="xp-n">${esc(r.status.toLowerCase())}</span><button type="button" data-act="block" data-domain="${esc(r.domain)}">Block</button>`}</div>`).join('')}</div>` : `<p class="xp-sub">No ${onlyBlocked ? 'blocked ' : ''}queries in the recent log.</p>`}`;
  }

  function renderLists() {
    const box = root.querySelector('[data-lists]'); if (!box) return;
    const rows = lists?.domains || [];
    const label = (d) => `${d.type === 'allow' ? 'Allow' : 'Block'}${d.kind === 'regex' ? ' · regex' : ''}`;
    box.innerHTML = `<div><h3>Your allow and block lists</h3><p class="xp-sub">Domains you added by hand. Blocklists from subscriptions are managed in Pi-hole.</p></div>
    <form class="xp-form" data-add><label class="flex flex-col gap-1 xp-sub">Domain<input class="${C.input}" name="domain" required maxlength="255" placeholder="example.com"></label>
    <label class="flex flex-col gap-1 xp-sub">List<select class="${C.select}" name="type"><option value="allow">Allow</option><option value="deny">Block</option></select></label>
    <label class="flex flex-col gap-1 xp-sub">Match<select class="${C.select}" name="kind"><option value="exact">Exact domain</option><option value="regex">Regex</option></select></label>
    <button class="${C.btnPrimary}" type="submit">${icon('plus', 'size-4')}Add</button></form>
    ${!lists ? '<p class="xp-sub">Loading…</p>' : rows.length ? `<div class="xp-rows">${rows.map((d) => `<div class="xp-row"><span class="xp-domain" title="${esc(d.domain)}">${esc(d.domain)}${d.comment ? ` <span class="xp-sub">— ${esc(d.comment)}</span>` : ''}</span>${badge(d.type === 'allow' ? 'green' : 'red', label(d))}${d.enabled ? '' : badge('blank', 'Disabled')}<button type="button" data-act="remove" data-type="${esc(d.type)}" data-kind="${esc(d.kind)}" data-domain="${esc(d.domain)}">Remove</button></div>`).join('')}</div>` : '<p class="xp-sub">No domains added by hand.</p>'}`;
    box.querySelector('[data-add]').onsubmit = async (e) => {
      e.preventDefault(); const f = e.target.elements; const entry = { domain: f.domain.value.trim(), type: f.type.value, kind: f.kind.value };
      await act(() => send('domains', 'POST', entry), `Added ${entry.domain} to the ${entry.type === 'allow' ? 'allow' : 'block'} list.`, ['lists']);
    };
  }

  async function act(run, done, reload) {
    say('Working…');
    try { await run(); say(done); await Promise.all(reload.map((k) => ({ overview: loadOverview, lists: loadLists, log: loadLog })[k]())); }
    catch (e) { say(e.message); }
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || !root.contains(b)) return;
    const d = b.dataset;
    if (d.act === 'pause') act(() => send('blocking', 'POST', { enabled: false, timer: Number(d.seconds) }), `Blocking paused for ${PAUSES.find(([s]) => s === Number(d.seconds))?.[1]}.`, ['overview']);
    if (d.act === 'disable' && confirm('Turn off blocking for the whole network until you turn it back on?')) act(() => send('blocking', 'POST', { enabled: false }), 'Blocking turned off.', ['overview']);
    if (d.act === 'enable') act(() => send('blocking', 'POST', { enabled: true }), 'Blocking is back on.', ['overview']);
    if (d.act === 'allow' || d.act === 'block') act(() => send('domains', 'POST', { domain: d.domain, type: d.act === 'allow' ? 'allow' : 'deny', kind: 'exact' }), `${d.domain} ${d.act === 'allow' ? 'is now allowed' : 'is now blocked'}. Remove it from your lists below to undo.`, ['lists']);
    if (d.act === 'remove' && confirm(`Remove ${d.domain} from your ${d.type === 'allow' ? 'allow' : 'block'} list?`)) act(() => send('domains', 'DELETE', { domain: d.domain, type: d.type, kind: d.kind }), `Removed ${d.domain}.`, ['lists']);
    if (d.act === 'log') { onlyBlocked = d.blocked === '1'; log = null; renderLog(); loadLog(); }
  });

  async function loadOverview() { try { const j = await req('overview'); if (!alive) return; const box = root.querySelector('[data-overview]'); data = j; if (box) box.innerHTML = overview(); else { render(); loadLists(); loadLog(); } } catch (e) { if (alive && !data) body.innerHTML = alertBlock('error', esc(e.message)); else say(e.message); } }
  async function loadLists() { try { lists = await req('domains'); if (alive) renderLists(); } catch (e) { say(e.message); } }
  async function loadLog() { try { log = await req('queries' + (onlyBlocked ? '?blocked=1' : '')); if (alive) renderLog(); } catch (e) { say(e.message); } }
  root.querySelector('[data-refresh]').onclick = () => { data = null; body.textContent = 'Loading…'; loadOverview(); };
  loadOverview();
  const timer = setInterval(() => { if (data) loadOverview(); }, 30000);
  return () => { alive = false; clearInterval(timer); };
}
