import {C,esc,icon,nf,alertBlock,LOCALE} from './ui.js';
const bytes=n=>{if(n==null)return '—';const u=['B','KiB','MiB','GiB','TiB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++;}return `${nf.format(n)} ${u[i]}`;};
const date=v=>v?new Date(typeof v==='number'?v*1000:v).toLocaleString(LOCALE):'—';
const table=(heads,rows)=>`<div class="${C.tableWrap}"><div class="${C.tableContainer}"><table class="${C.table}"><thead class="${C.thead}"><tr>${heads.map(h=>`<th class="${C.th}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr class="${C.tr}">${row.map(v=>`<td class="${C.td}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
const OPS_CSS=`
.xo { color:var(--foreground); }
.xo-tabs { display:flex; gap:4px; flex-wrap:wrap; padding:4px; background:var(--muted); border-radius:10px; width:fit-content; }
.xo-tabs button { padding:8px 12px; border-radius:7px; font-size:13px; cursor:pointer; color:var(--muted-foreground); }
.xo-tabs button[aria-selected=true] { background:var(--background); color:var(--foreground); box-shadow:0 1px 3px var(--border); }
.xo-tabs button:focus-visible,.xo summary:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
.xo-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:12px; justify-content:space-between; }
.xo-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr)); gap:14px; }
.xo-card { padding:20px; border:1px solid var(--border); border-radius:12px; background:var(--card); min-width:0; }
.xo-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:16px; }
.xo-heading h3 { font-size:15px; line-height:1.5; font-weight:600; overflow-wrap:anywhere; }
.xo-sub { color:var(--muted-foreground); font-size:12px; line-height:1.6; }
.xo-metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; }
.xo-metrics dt { color:var(--muted-foreground); font-size:12px; margin-bottom:4px; }
.xo-metrics dd { font-size:17px; font-weight:600; font-variant-numeric:tabular-nums; }
.xo-summary { display:flex; flex-wrap:wrap; gap:28px; padding:0 0 20px; border-bottom:1px solid var(--border); }
.xo-summary span { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--muted-foreground); }
.xo-summary strong { font-size:22px; font-weight:600; color:var(--foreground); }
.xo details { margin-top:16px; font-size:12px; }
.xo summary { color:var(--muted-foreground); cursor:pointer; padding:4px 0; }
.xo details ul { margin-top:10px; display:flex; flex-direction:column; gap:6px; overflow-wrap:anywhere; }
.xo-note { padding:0 2px; color:var(--muted-foreground); line-height:1.7; }
.xo-empty { padding:40px 20px; text-align:center; border:1px dashed var(--border); border-radius:12px; }
.xo-empty h3 { font-size:16px; font-weight:600; margin-bottom:8px; }
.xo-event { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:16px; padding:16px 0; border-bottom:1px solid var(--border); }
.xo-event:last-child { border-bottom:0; }
.xo-badge { display:inline-flex; width:fit-content; border:1px solid var(--border); padding:3px 8px; border-radius:6px; font-size:11px; white-space:nowrap; }
.xo-card[data-failure=true] { border-color:var(--destructive); }
.xo-card figure { border-top:1px solid var(--border); padding-top:14px; }
.xo [data-search] { max-width:380px; }
@media(max-width:550px) { .xo-metrics { gap:8px; } .xo-metrics dd { font-size:14px; } .xo-event { grid-template-columns:1fr; gap:6px; } }
`;
const note=text=>`<details class="xo-note"><summary>About these numbers</summary><p>${text}</p></details>`;
const empty=(title,description)=>`<div class="xo-empty"><h3>${title}</h3><p class="xo-sub">${description}</p></div>`;
const friendly=name=>String(name).replace(/^apps-/,'').replace(/-[a-z0-9]{6}$/,'').replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const metric=(label,value)=>`<div><dt>${label}</dt><dd>${value}</dd></div>`;
function plot(history,key,label,unit) {
 const names=[...new Set(history.flatMap(s=>s.disks.map(d=>d.name)))];
 const series=key==='memory_pressure_pct'?[{name:'Memory PSI',points:history.filter(s=>s[key]!=null).map(s=>({at:s.at,v:s[key]}))}]:names.map(name=>({name,points:history.map(s=>({at:s.at,v:s.disks.find(d=>d.name===name)?.[key]??null})).filter(p=>p.v!=null)}));
 return `<section class="flex flex-col gap-3"><h3 class="font-medium">${esc(label)}</h3>${series.map(s=>{
  if(s.points.length<2)return `<p class="${C.muted}">${esc(s.name)}: collecting samples…</p>`;
  const max=Math.max(...s.points.map(p=>p.v),1);const start=s.points[0].at;const span=s.points.at(-1).at-start||1;
  const points=s.points.map(p=>`${((p.at-start)/span*600).toFixed(2)},${(100-p.v/max*90).toFixed(2)}`).join(' ');
  return `<figure class="flex flex-col gap-2"><figcaption class="${C.small}">${esc(s.name)} — current: ${nf.format(s.points.at(-1).v)} ${esc(unit)}, scale: 0–${nf.format(max)}</figcaption><svg viewBox="0 0 600 110" role="img" aria-label="${esc(label+' '+s.name)}" style="width:100%;height:120px"><polyline points="${points}" fill="none" stroke="var(--primary)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><p class="${C.small}">${date(start)} — ${date(s.points.at(-1).at)}</p></figure>`;
 }).join('')}</section>`;
}
export function render(tab,data,query='') {
 if(tab==='docker'){
  const all=data.apps||[],q=query.toLowerCase().trim(),apps=all.filter(a=>!q||`${a.name} ${a.containers.join(' ')} ${a.volumes.join(' ')}`.toLowerCase().includes(q));
  const count=all.reduce((n,a)=>n+a.containers.length,0),writes=all.filter(a=>a.containers.length).reduce((n,a)=>n+a.writable_bytes,0);
  return `${data.docker_error?alertBlock('error',esc(data.docker_error)):''}<div class="xo-summary"><span><strong>${all.length}</strong>Application groups</span><span><strong>${count}</strong>Containers</span><span><strong>${bytes(writes)}</strong>Container writes</span></div>
  <div class="xo-grid">${apps.map(a=>`<article class="xo-card"><div class="xo-heading"><div><h3>${esc(friendly(a.name))}</h3><p class="xo-sub">${a.containers.length} container${a.containers.length===1?'':'s'}</p></div></div><dl class="xo-metrics">${metric('Volumes',bytes(a.volume_bytes))}${metric('Images',bytes(a.image_bytes))}${metric('Writes',bytes(a.writable_bytes))}</dl><details><summary>Containers and storage details</summary><ul><li><b>Docker group:</b> ${esc(a.name)}</li>${a.containers.map(n=>`<li><b>Container:</b> ${esc(n)}</li>`).join('')}${a.volumes.map(n=>`<li><b>Volume:</b> ${esc(n)}</li>`).join('')}${!a.volumes.length?'<li>No named Docker volumes. Bind-mounted folders are not included.</li>':''}</ul></details></article>`).join('')}</div>
  ${!apps.length?empty(all.length?'No matching applications':'Waiting for Docker data',all.length?'Try another application or container name.':'The collector will populate this view automatically.'):''}
  ${note('Stored data covers named Docker volumes. Images and volumes can be shared between applications, so their sizes must not be added together. Writes are changes inside container writable layers. Build cache is shown as a separate global group.')}`;
 }
 if(tab==='incidents'){
  const events=[...(data.events||[])].reverse();
  const kinds={unhealthy:['Health check failed','The container did not pass its Docker health check.'],oom:['Out of memory','The container was terminated after running out of memory.'],restart:['Container restarted','The restart counter increased since the last check.'],stopped:['Container is stopped','This may be intentional. Check the service before taking action.'],recovered:['Service recovered','The previously observed issue is no longer present.']};
  return events.length?`<div class="xo-card">${events.map(e=>{const [title,desc]=kinds[e.kind]||[e.kind,''];return `<article class="xo-event"><div><p class="font-medium">${esc(title)} <span class="xo-sub">— ${esc(friendly(e.app))}</span></p><p class="xo-sub">${desc}</p><details><summary>Container details</summary><p class="xo-sub">${esc(e.container)}</p></details></div><time class="xo-sub">${date(e.at)}</time></article>`;}).join('')}</div>${note('The collector checks container state every minute. This is an event history, not a list of currently active incidents. Container replacement can reset restart counters.')}`:empty('No incidents recorded','Container health changes and recoveries will appear here.');
 }
 if(tab==='backups'){
  const rows=data.backups||[];
  const status=b=>b.lastStatus==='done'?'Successful':b.lastStatus==='error'?'Failed':b.lastStatus==='running'?'Running':b.lastStatus||'Not run yet';
  return `${data.errors?.length?alertBlock('warning',`${data.errors.length} resources could not be checked. Open details below for more information.`):''}
   ${rows.length?`<div class="xo-grid">${rows.map(b=>`<article class="xo-card" data-failure="${b.lastStatus==='error'}"><div class="xo-heading"><div><h3>${esc(b.name)}</h3><p class="xo-sub">${esc(b.project)} · ${esc(b.destination||'Destination not available')}</p></div><span class="xo-badge">${esc(status(b))}</span></div><p class="text-sm">Last successful backup</p><p class="font-medium">${b.lastSuccess?date(b.lastSuccess):'No successful run recorded'}</p><details><summary>Schedule and execution details</summary><ul><li><b>Schedule:</b> ${esc(b.schedule||'Not available')} (cron)</li><li><b>Scheduling:</b> ${b.enabled?'Enabled':'Disabled'}</li><li><b>Latest attempt:</b> ${date(b.lastRun)}</li></ul></details></article>`).join('')}</div>`:empty('No backup schedules found','Create a backup schedule in your database or service settings in Dokploy.')}
   ${data.errors?.length?`<details><summary>Resources that could not be checked</summary><ul>${data.errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></details>`:''}
   ${note('This view covers backups managed by Dokploy. External backup jobs are not included. A successful backup job does not confirm that a restoration has been tested.')}`;
 }
 const h=data.history||[];
 return h.length<2?empty('Collecting disk history','The first chart appears after two samples, about a minute apart.'):`<div class="xo-grid">${[['read_bps','Read throughput','B/s'],['write_bps','Write throughput','B/s'],['latency_ms','Disk latency','ms'],['busy_pct','Disk busy time','%'],['memory_pressure_pct','Memory pressure','%']].map(([key,label,unit])=>`<div class="xo-card">${plot(h,key,label,unit)}</div>`).join('')}</div>${note('History covers up to 24 hours, sampled every minute. Latency is the mean time per completed disk operation. Memory pressure is the time tasks spend waiting for available memory.')}`;
}
export function mount(root,{api}) {
 let tab='docker',alive=true,loading=false,currentData=null,query='',owner=false;
 root.innerHTML=`<style>${OPS_CSS}</style><div class="${C.page} xo"><div class="${C.outer}"><div class="${C.inner}"><div class="${C.header}"><h2 class="${C.title}">${icon('hardDrive',C.titleIcon)}Operations</h2><p class="${C.desc}">See what uses your storage and what needs attention.</p></div><div class="${C.content} flex flex-col gap-6"><div class="xo-toolbar"><div class="xo-tabs" role="tablist" aria-label="Operations views">${[['docker','Storage'],['incidents','Incidents'],['backups','Backups'],['history','Performance']].map(([id,label])=>`<button type="button" role="tab" data-tab="${id}">${label}</button>`).join('')}</div><div class="flex flex-wrap gap-2"><button class="${C.btnOutlineSm}" data-refresh>Refresh</button><button class="${C.btnOutlineSm}" data-cleanup hidden>Clean up images</button></div></div><label data-search-wrap><input type="search" class="${C.input}" data-search aria-label="Search applications" placeholder="Find an application…"></label><div data-body class="flex flex-col gap-8"></div></div></div></div></div>`;
 const body=root.querySelector('[data-body]');
 async function load(){if(loading||tab==='cleanup')return;loading=true;const requested=tab;try{const r=await api('/operations/'+(tab==='backups'?'backups':'insights'));const j=await r.json();if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);if(alive&&requested===tab){currentData=j;body.innerHTML=render(tab,j,query);}}catch(e){if(alive&&requested===tab)body.innerHTML=alertBlock('error',esc(e.message));}finally{loading=false;if(alive&&requested!==tab)load();}}
 root.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;root.querySelector('[data-search-wrap]').hidden=tab!=='docker';cleanup.hidden=!owner||tab!=='docker';root.querySelectorAll('[data-tab]').forEach(x=>x.setAttribute('aria-selected',x===b));body.textContent='Loading…';load();});
 root.querySelector('[data-search]').oninput=e=>{query=e.target.value;if(tab==='docker'&&currentData)body.innerHTML=render(tab,currentData,query);};
 const cleanup=root.querySelector('[data-cleanup]');
 api('/me').then(r=>r.json()).then(me=>{if(alive){owner=me.role==='owner';cleanup.hidden=!owner||tab!=='docker';}}).catch(()=>{});
 const post=async(path,body={})=>{const r=await api('/operations/cleanup/'+path,{method:'POST',headers:{'content-type':'application/json','x-ext-csrf':'1'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);return j;};
 cleanup.onclick=async()=>{
  tab='cleanup';root.querySelector('[data-search-wrap]').hidden=true;root.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected','false'));body.textContent='Loading cleanup preview…';
  try {const plan=await post('preview');if(!alive)return;
   body.innerHTML=`${alertBlock('warning','Only untagged images older than 7 days with no container references are eligible. Select images to delete. No containers, named images, build cache or volumes will be removed. Preview expires in 5 minutes.')}${table(['Select','Image','Size'],plan.images.map(i=>[`<input type="checkbox" data-image value="${esc(i.id)}" aria-label="Select image ${esc(i.id)}">`,esc(i.id),bytes(i.size_bytes)]))}<button type="button" class="${C.btnDestructive}" data-apply ${plan.images.length?'':'disabled'}>Delete selected images</button><p role="status" data-cleanup-status>${plan.images.length?'':'No eligible images.'}</p>`;
   body.querySelector('[data-apply]').onclick=async e=>{
    const ids=[...body.querySelectorAll('[data-image]:checked')].map(x=>x.value);if(!ids.length){body.querySelector('[data-cleanup-status]').textContent='Select at least one image.';return;}
    if(!window.confirm(`Delete these ${ids.length} untagged images? This cannot be undone.`))return;
    e.currentTarget.disabled=true;
    try {const result=await post('apply',{ticket:plan.ticket,ids,confirmation:'DELETE'});if(alive)body.innerHTML=table(['Image','Result'],result.results.map(r=>[esc(r.id),r.deleted?'Deleted':esc(r.error)]));}catch(err){if(alive){body.querySelector('[data-cleanup-status]').textContent=err.message;body.querySelector('[data-apply]').disabled=false;}}
   };
  }catch(e){if(alive)body.innerHTML=alertBlock('error',esc(e.message));}
 };
 root.querySelector('[data-tab=docker]').setAttribute('aria-selected','true');root.querySelector('[data-refresh]').onclick=()=>tab==='cleanup'?cleanup.click():load();load();const timer=setInterval(()=>{if(!['backups','cleanup'].includes(tab)&&!body.querySelector('details[open]'))load();},60000);
 return()=>{alive=false;clearInterval(timer);};
}
