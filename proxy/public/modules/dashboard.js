import {C,esc,icon,t,alertBlock,LOCALE,nf} from './ui.js';
const kindName=k=>({jellyfin:'Jellyfin',homeassistant:'Home Assistant',uptimekuma:'Uptime Kuma',beszel:'Beszel',link:t('Raccourci','Shortcut')})[k];
const DASHBOARD_CSS = `
.xd { --xd-surface:var(--card); --xd-line:var(--border); --xd-muted:var(--muted-foreground); --xd-accent:var(--primary); }
.xd-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin-bottom:24px; }
.xd-search { position:relative; flex:1 1 240px; max-width:380px; }
.xd-search svg { position:absolute; left:12px; top:12px; width:16px; height:16px; color:var(--xd-muted); pointer-events:none; }
.xd-search input { padding-left:38px; }
.xd-filters { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
.xd-filter { border:1px solid transparent; border-radius:8px; padding:7px 11px; font-size:13px; color:var(--xd-muted); cursor:pointer; }
.xd-filter:hover { background:var(--muted); color:var(--foreground); }
.xd-filter[aria-pressed=true] { color:var(--foreground); border-color:var(--xd-line); background:var(--muted); }
.xd-filter:focus-visible, .xd-main:focus-visible { outline:2px solid var(--ring); outline-offset:3px; }
.xd-section { margin-bottom:28px; }
.xd-section-head { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
.xd-section-head h3 { font-size:15px; font-weight:600; }
.xd-count { font-size:12px; color:var(--xd-muted); font-variant-numeric:tabular-nums; }
.xd-rule { flex:1; height:1px; background:var(--xd-line); margin-left:4px; }
.xd-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr)); gap:12px; }
.xd-card { min-width:0; display:flex; flex-direction:column; border:1px solid var(--xd-line); border-radius:12px; background:var(--xd-surface); transition:border-color .15s,transform .15s,box-shadow .15s; }
.xd-card:hover { transform:translateY(-2px); border-color:color-mix(in oklab,var(--xd-accent) 45%,var(--xd-line)); box-shadow:0 6px 16px -12px var(--foreground); }
.xd-main { display:flex; align-items:center; gap:14px; padding:18px; border-radius:12px; text-decoration:none; color:inherit; min-height:98px; }
.xd-logo { width:50px; height:50px; flex:none; border-radius:12px; background:var(--background); border:1px solid var(--xd-line); display:grid; place-items:center; position:relative; overflow:hidden; }
.xd-logo img { width:34px; height:34px; object-fit:contain; z-index:1; }
.xd-initials { color:var(--xd-accent); font-size:17px; font-weight:600; }
.xd-logo img + .xd-initials { display:none; }
.xd-logo img[hidden] + .xd-initials { display:block; }
.xd-copy { min-width:0; flex:1; display:flex; flex-direction:column; gap:4px; }
.xd-name { font-weight:600; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.xd-host { font-size:12px; color:var(--xd-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.xd-health { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--xd-muted); white-space:nowrap; }
.xd-health i { width:8px; height:8px; border-radius:50%; flex:none; background:var(--xd-muted); }
.xd-health[data-status=up] i { background:#22c55e; }
.xd-health[data-status=pending] i, .xd-health[data-status=maintenance] i { background:#f59e0b; }
.xd-health[data-status=down] { color:var(--destructive); }
.xd-health[data-status=down] i { background:var(--destructive); }
.xd-open { width:16px; height:16px; flex:none; color:var(--xd-muted); opacity:.5; }
.xd-main:hover .xd-open { opacity:1; color:var(--xd-accent); }
.xd-details { padding:0 18px 16px; display:flex; flex-direction:column; gap:6px; font-size:12px; }
.xd-details > p:last-child { font-size:11px; }
.xd-empty { padding:40px 16px; text-align:center; color:var(--xd-muted); border:1px dashed var(--xd-line); border-radius:12px; }
@media (prefers-reduced-motion:reduce) { .xd-card { transition:none; } .xd-card:hover { transform:none; } }
`;
const LOGOS = [
 ['homeassistant','home-assistant'],['jellyfin','jellyfin'],['jellyseerr','jellyseerr'],['jellystat','jellystat'],
 ['qbittorrent','qbittorrent'],['radarr','radarr'],['sonarr','sonarr'],['prowlarr','prowlarr'],['plex','plex'],['wizarr','wizarr'],
 ['nextcloud','nextcloud'],['komga','komga'],['kavita','kavita'],['octoprint','octoprint'],['obsidian','obsidian'],
 ['uptimekuma','uptime-kuma'],['beszel','beszel'],['pterodactyl','pterodactyl'],['wings','pterodactyl'],['n8n','n8n'],['pihole','pi-hole'],['gitea','gitea'],['archisteamfarm','archisteamfarm.png'],['linkwarden','linkwarden.png'],['speedtest','speedtest-tracker.png'],['orcaslicer','orcaslicer.png'],['dbgate','dbgate'],['docker','docker'],['postgres','postgres'],
];
export function logoFor(app) {
 if(app.logo)return app.logo;
 const key=(app.integration+' '+app.name+' '+new URL(app.url).hostname).toLowerCase().replace(/[^a-z0-9]/g,'');
 const known=LOGOS.find(([match])=>key.includes(match));
 return known ? '/_ext/static/logos/'+known[1]+(known[1].includes('.')?'':'.svg') : new URL('/favicon.ico',app.url).href;
}
const pct=new Intl.NumberFormat(LOCALE,{maximumFractionDigits:2}); // 99.96 must not round up to 100
// Uptime Kuma status shown on a card: state + 24 h uptime, and the TLS certificate when it needs attention.
export function healthBadge(h) {
 if(!h)return '';
 const label={up:'Up',down:'Down',pending:'Pending',maintenance:'Maintenance'}[h.status]||'Awaiting first check';
 const line=[label,h.uptime24h==null?'':`${pct.format(Math.floor(h.uptime24h*100)/100)}% over 24 h`].filter(Boolean).join(' · ');
 const cert=h.certificateValid===false?'TLS certificate invalid':h.certificateDays!=null&&h.certificateDays<14?`TLS certificate expires in ${Math.max(0,Math.floor(h.certificateDays))} days`:'';
 const title=`Uptime Kuma${h.pingMs==null?'':` · ${nf.format(h.pingMs)} ms response`}${h.certificateDays==null||cert?'':` · TLS certificate valid ${Math.floor(h.certificateDays)} more days`}`;
 return `<span class="xd-health" data-status="${esc(h.status||'unknown')}" title="${esc(title)}"><i aria-hidden="true"></i>${esc(line)}</span>${cert?`<span class="xd-health" data-status="down"><i aria-hidden="true"></i>${esc(cert)}</span>`:''}`;
}
export function appCard(app,details='',health=null) {
 const host=new URL(app.url).host;
 const initials=app.name.split(/[\s_-]+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();
 return `<article class="xd-card"><a class="xd-main" href="${esc(app.url)}" target="_blank" rel="noopener noreferrer" title="Open ${esc(app.name)} in a new tab">
 <span class="xd-logo"><img src="${esc(logoFor(app))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="xd-initials" aria-hidden="true">${esc(initials)}</span></span>
 <span class="xd-copy"><span class="xd-name">${esc(app.name)}</span><span class="xd-host">${esc(host)}</span>${healthBadge(health)}</span>
 <svg class="xd-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M15 3h6v6m0-6L10 14M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/></svg></a>
 ${details?`<div class="xd-details">${details}</div>`:''}</article>`;
}
export function beszelCards(app,state) {
 if(!state?.systems?.length)return '';
 const pct=v=>v==null?'—':`${Number(v).toFixed(1)}%`;
 const metric=(label,v)=>`<div><div class="flex justify-between gap-3 text-xs"><span class="text-muted-foreground">${label}</span><span>${pct(v)}</span></div><div style="height:4px;border-radius:4px;background:var(--muted);margin-top:6px;overflow:hidden"><div style="height:100%;background:var(--primary);width:${Math.max(0,Math.min(100,v||0))}%"></div></div></div>`;
 return `<section class="xd-section"><div class="xd-section-head"><h3>Servers</h3><span class="xd-count">via Beszel</span><span class="xd-rule" aria-hidden="true"></span></div><div class="xd-grid">${state.systems.map(s=>{
  const fresh=s.updated&&Date.now()-new Date(s.updated.replace(' ','T')).getTime()<180000;
  const up=s.status==='up'&&fresh;
  const details=`<p class="font-medium">${esc(s.status)}${s.status==='up'&&!fresh?' — stale data':''}</p>${up?`<div class="grid gap-3">${metric('CPU',s.cpu)}${metric('Memory',s.memoryPct)}${metric('Disk',s.diskPct)}</div>`:''}<p class="text-muted-foreground">${s.updated?`Updated ${esc(new Date(s.updated.replace(' ','T')).toLocaleTimeString(LOCALE))}`:'Awaiting first sample'}</p>`;
  return appCard({name:s.name,url:s.url,integration:'beszel',logo:'/_ext/static/logos/beszel.svg'},details);
 }).join('')}</div></section>`;
}
export function mount(root,{api}) {
 let alive=true,editing=false,data=null,query='',category=null;
 const call=async(options)=>{const r=await api('/dashboard',options);const j=await r.json();if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);return j;};
 function state(app) {
  const s=data.states?.[app.id];
  if(app.integration==='link')return '';
  if(!s)return `<p class="${C.muted}">${t('Chargement…','Loading…')}</p>`;
  if(s.online===null)return `<p class="${C.muted}">${t('Jeton requis dans les réglages du Dashboard.','Token required in Dashboard settings.')}</p>`;
  if(app.integration==='uptimekuma'&&s.online)return `<p class="${C.muted}">${s.monitors.length} monitors available</p>`;
  if(app.integration==='beszel'&&s.online)return `<p class="${C.muted}">${s.systems.length} monitored servers</p>`;
  const status=s.online?t('En ligne','Online'):t('Indisponible','Unavailable');
  return `<p class="text-sm">${esc(status)}${s.version?` — ${esc(s.version)}`:''}</p>
   ${s.error?`<p class="${C.muted}">${esc(s.error)}</p>`:''}
   ${s.playing?`<div class="${C.muted}">${s.playing.length?s.playing.map(p=>`<p>${esc(p.title)}${p.paused?` (${t('en pause','paused')})`:''}</p>`).join(''):t('Aucune lecture en cours.','Nothing playing.')}</div>`:''}
   ${s.online && app.integration==='jellyfin' && !s.configured?`<p class="${C.muted}">${t('Ajoute un jeton pour afficher les lectures.','Add a token to show active playback.')}</p>`:''}
   ${s.entities?.map(e=>`<p class="text-sm">${esc(e.name)} : ${esc(e.state)} ${esc(e.unit)}</p>`).join('')||''}
   <p class="${C.small}">${t('Vérifié à','Checked at')} ${esc(new Date(s.at).toLocaleTimeString(LOCALE))}</p>`;
 }
 function renderCards() {
  const q=query.trim().toLowerCase();
  const shown=data.apps.filter(a=>(!category||a.category===category)&&(!q||`${a.name} ${a.url} ${a.category}`.toLowerCase().includes(q)));
  const body=root.querySelector('[data-cards]');
  const servers=data.apps.filter(a=>a.integration==='beszel'&&(!category||a.category===category)).map(a=>{const state=data.states?.[a.id];return beszelCards(a,state?.systems?{...state,systems:state.systems.filter(s=>!q||s.name.toLowerCase().includes(q))}:state);}).join('');
  body.innerHTML=data.categories.map(cat=>{
   const apps=shown.filter(a=>a.category===cat);
   return apps.length?`<section class="xd-section"><div class="xd-section-head"><h3>${esc(cat)}</h3><span class="xd-count">${apps.length}</span><span class="xd-rule" aria-hidden="true"></span></div><div class="xd-grid">${apps.map(a=>appCard(a,state(a),data.health?.[a.id])).join('')}</div></section>`:'';
  }).join('')||`<div class="xd-empty">${data.apps.length?'No applications match your search.':'Add your first application with Customize.'}</div>`;
  if(servers)body.innerHTML=servers+body.innerHTML;
  body.querySelectorAll('img').forEach(img=>{const fallback=()=>{img.hidden=true;};img.addEventListener('error',fallback,{once:true});if(img.complete&&!img.naturalWidth)fallback();});
  root.querySelectorAll('[data-category-filter]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.categoryFilter===(category||'')));
  const desc=root.querySelector('[data-summary]');if(desc)desc.innerHTML=summary();
 }
 function summary() {
  const base=`${data.apps.length} applications across ${data.categories.length} categories`;
  const h=Object.values(data.health||{});if(!h.length)return base;
  const down=h.filter(x=>x.status==='down').length;
  return `${base} · ${down?`<span class="text-destructive">${down} down</span>`:'all monitored apps up'}`;
 }
 function render() {
  root.innerHTML=`<style>${DASHBOARD_CSS}</style><div class="${C.page} xd"><div class="${C.outer}"><div class="${C.inner}"><div class="${C.header}"><h2 class="${C.title}">Dashboard</h2><p class="${C.desc}" data-summary>${summary()}</p><div class="${C.action}"><button class="${C.btnOutlineSm}" data-refresh>${icon('refresh','size-4')}Refresh</button>${data.owner?`<button class="${C.btnOutlineSm}" data-edit>${icon('plus','size-4')}Customize</button>`:''}</div></div><div class="${C.content}">
  <div class="xd-toolbar"><label class="xd-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg><input class="${C.input}" type="search" data-search placeholder="Find an application…" aria-label="Search applications" value="${esc(query)}"></label>
  <div class="xd-filters" aria-label="Filter by category"><button class="xd-filter" type="button" data-category-filter="">All apps</button>${data.categories.map(c=>`<button class="xd-filter" type="button" data-category-filter="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>
  <div data-cards></div></div></div></div></div>`;
  root.querySelector('[data-edit]')?.addEventListener('click',editor);
  root.querySelector('[data-refresh]').onclick=load;
  root.querySelector('[data-search]').oninput=e=>{query=e.target.value;renderCards();};
  root.querySelectorAll('[data-category-filter]').forEach(b=>b.onclick=()=>{category=b.dataset.categoryFilter||null;renderCards();});
  renderCards();
 }
 function row(a={name:'',url:'',category:data.categories[0],integration:'link',entities:[]}) {
  const box=document.createElement('div');box.className='grid gap-3 rounded-lg border p-4';box.dataset.appId=a.id||crypto.randomUUID();
  box.innerHTML=`<label>${t('Nom','Name')}<input class="${C.input}" data-name value="${esc(a.name)}" required maxlength="120"></label>
  <label>URL<input class="${C.input}" data-url type="url" value="${esc(a.url)}" placeholder="https://example.com" required></label>
  <label>Logo URL <span class="${C.small}">(optional, detected automatically)</span><input class="${C.input}" data-logo type="url" value="${esc(a.logo||'')}" placeholder="https://example.com/logo.svg"></label>
  <label>${t('Catégorie','Category')}<input class="${C.input}" data-category value="${esc(a.category)}" required list="dashboard-categories"></label>
  <label>${t('Intégration','Integration')}<select class="${C.select}" data-kind>${['link','jellyfin','homeassistant','beszel','uptimekuma'].map(k=>`<option value="${k}" ${a.integration===k?'selected':''}>${esc(kindName(k))}</option>`).join('')}</select></label>
  <label>${t('Entités Home Assistant (6 maximum, séparées par des virgules)','Home Assistant entities (up to 6, comma-separated)')}<input class="${C.input}" data-entities value="${esc(a.entities.join(', '))}" placeholder="sensor.temperature, light.salon"></label>
  <button type="button" class="${C.btnOutlineSm}" data-remove>${t('Retirer la carte','Remove card')}</button>`;
  box.querySelector('[data-remove]').onclick=()=>box.remove();return box;
 }
 function editor() {
  editing=true;
  root.innerHTML=`<div class="${C.page}"><div class="${C.outer}"><div class="${C.inner}"><div class="${C.header}"><h2 class="${C.title}">${t('Personnaliser le Dashboard','Customize Dashboard')}</h2><p class="${C.desc}">${t('Réglages partagés. Les jetons sont chiffrés côté serveur.','Shared settings. Tokens are encrypted on the server.')}</p></div><form class="${C.content} flex flex-col gap-6">
  <label>${t('Catégories, une par ligne','Categories, one per line')}<textarea class="${C.input}" name="categories" style="min-height:100px" required>${esc(data.categories.join('\n'))}</textarea></label><datalist id="dashboard-categories">${data.categories.map(c=>`<option value="${esc(c)}">`).join('')}</datalist>
  <div data-apps class="grid gap-4 md:grid-cols-2"></div><button type="button" class="${C.btnOutlineSm}" data-add>${t('Ajouter une application','Add application')}</button>
  <p class="${C.small}">Manage service credentials and test connections in <a class="underline" href="#ext-settings">Settings</a>.</p>
  <div class="flex gap-2"><button class="${C.btnPrimary}" type="submit">${t('Enregistrer','Save')}</button><button class="${C.btnOutline}" type="button" data-cancel>${t('Annuler','Cancel')}</button></div><p role="status" data-status></p></form></div></div></div>`;
  const apps=root.querySelector('[data-apps]');data.apps.forEach(a=>apps.appendChild(row(a)));
  root.querySelector('[data-add]').onclick=()=>apps.appendChild(row());
  root.querySelector('[data-cancel]').onclick=()=>{editing=false;render();};
  root.querySelector('form').onsubmit=async e=>{
   e.preventDefault();const f=e.target.elements;
   const patch={categories:f.categories.value.split('\n').map(c=>c.trim()).filter(Boolean),apps:[...apps.children].map(b=>({id:b.dataset.appId,name:b.querySelector('[data-name]').value,url:b.querySelector('[data-url]').value,category:b.querySelector('[data-category]').value,logo:b.querySelector('[data-logo]').value.trim(),integration:b.querySelector('[data-kind]').value,entities:b.querySelector('[data-entities]').value.split(',').map(v=>v.trim()).filter(Boolean)}))};

   const button=e.target.querySelector('[type=submit]');button.disabled=true;
   try {await call({method:'PUT',headers:{'content-type':'application/json','x-ext-csrf':'1'},body:JSON.stringify(patch)});editing=false;root.innerHTML="";category=null;await load();}catch(e){if(alive){root.querySelector('[data-status]').textContent=e.message;button.disabled=false;}}
  };
 }
 async function load(){try {const next=await call();if(alive&&!editing){data=next;if(root.querySelector('[data-cards]'))renderCards();else render();}}catch(e){if(alive&&!editing)root.innerHTML=alertBlock('error',esc(e.message));}}
 root.innerHTML=`<p>${t('Chargement…','Loading…')}</p>`;load();
 const timer=setInterval(()=>{if(!editing)load();},30000);return()=>{alive=false;clearInterval(timer);};
}
