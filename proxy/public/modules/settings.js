import {C,esc,icon,alertBlock} from './ui.js';
const SERVICES=[['cloudflare','Cloudflare',[['cloudflareToken','API token']],false],['jellyfin','Jellyfin',[['jellyfinToken','API token']],true],['homeassistant','Home Assistant',[['homeassistantToken','Long-lived access token']],true],['beszel','Beszel',[['beszelEmail','Read-only account email'],['beszelPassword','Account password']],true],['uptimekuma','Uptime Kuma',[['uptimeKumaKey','Metrics API key']],true],['sonarr','Sonarr',[['sonarrKey','API key (Sonarr → Settings → General)']],true],['radarr','Radarr',[['radarrKey','API key (Radarr → Settings → General)']],true],['speedtest','Speedtest Tracker',[['speedtestToken','API token with the results:read ability']],true],['pihole','Pi-hole',[['piholePassword','App password (Pi-hole → Settings → Web interface / API)']],true],['discord','Discord alerts',[['discordWebhook','Webhook URL']],false]];
export function mount(root,{api}) {
 let alive=true;
 const request=async(path,options)=>{const r=await api('/settings'+path,options);const j=await r.json();if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);return j;};
 const headers={'content-type':'application/json','x-ext-csrf':'1'};
 async function load(){try{const s=await request('');if(!alive)return;
  root.innerHTML=`<div class="${C.page}"><div class="${C.outer}"><div class="${C.inner}"><div class="${C.header}"><h2 class="${C.title}">Settings</h2><p class="${C.desc}">Manage modules, service connections and alert thresholds.</p></div><section data-update class="${C.content} flex flex-col gap-3"><p class="${C.small}">Checking for updates…</p></section><form class="${C.content} flex flex-col gap-8"><fieldset class="flex flex-col gap-8" ${s.owner?'':'disabled'}>
  <section class="flex flex-col gap-4"><h3 class="font-medium text-base">General</h3><label class="flex flex-col gap-2">Browser tab title<input name="siteTitle" class="${C.input}" maxlength="80" value="${esc(s.siteTitle)}" placeholder="Dokploy"></label><div class="flex flex-wrap gap-6">${['storage','cloudflare'].map(k=>`<label class="flex items-center gap-2"><input type="checkbox" name="${k}" ${s.modules[k]?'checked':''}>Enable ${k==='storage'?'Storage':'Cloudflare'}</label>`).join('')}</div></section>
  <section class="flex flex-col gap-4"><h3 class="font-medium text-base">Connections</h3><p class="${C.small}">Saved credentials are never displayed. Leave a field empty to keep it, or select Clear saved value. Test connection checks the values currently in the form.</p><div class="grid gap-4 md:grid-cols-2">${SERVICES.map(([id,name,fields,hasUrl])=>{const info=s.connections[id];return `<article class="${C.card}" data-service="${id}"><div class="${C.cardHeader}"><h4 class="${C.cardTitle}">${name}</h4></div><div class="${C.cardContent} flex flex-col gap-4">${hasUrl?`<label>Service base URL<input class="${C.input}" data-url type="url" value="${esc(info.url)}" placeholder="https://service.example.com"></label>`:''}${fields.map(([key,label])=>`<div class="flex flex-col gap-2"><label>${label} <span class="${C.small}">${info.saved[key]?'Saved':'Not configured'}</span><input class="${C.input}" name="${key}" type="${key.endsWith('Email')?'email':'password'}" autocomplete="new-password" placeholder="Leave empty to keep saved value"></label><label class="${C.small}"><input type="checkbox" name="clear-${key}"> Clear saved value</label></div>`).join('')}<button type="button" class="${C.btnOutlineSm}" data-test="${id}">${icon('refresh','size-4')}Test connection</button><p class="${C.small}" data-result role="status"></p></div></article>`;}).join('')}</div></section>
  <section class="flex flex-col gap-4"><h3 class="font-medium text-base">Storage alerts</h3><div class="grid gap-4 md:grid-cols-3">${[['usagePct','Disk usage threshold (%)',50,99],['tempC','Hard disk temperature alert (°C) — SSD/NVMe use their own limit',30,90],['intervalMin','Check interval (minutes)',1,1440]].map(([key,label,min,max])=>`<label>${label}<input class="${C.input}" name="${key}" type="number" min="${min}" max="${max}" required value="${s.alerts[key]}"></label>`).join('')}</div></section>
  <div class="flex items-center gap-4"><button class="${C.btnPrimary}" type="submit">Save settings</button><p role="status" data-status></p></div></fieldset>${s.owner?'':'<p>Only the Dokploy owner can change settings.</p>'}<p class="${C.small}">Version ${esc(s.version)} · Dashboard routing: ${esc(s.traefik?.status||'unknown')}</p></form></div></div></div>`;
  const form=root.querySelector('form'),status=root.querySelector('[data-status]');
  function connectionPatch(id){const [, ,fields,hasUrl]=SERVICES.find(row=>row[0]===id);const box=root.querySelector(`[data-service="${id}"]`);const body={};if(hasUrl)body.integrations={[id]:{url:box.querySelector('[data-url]').value}};for(const [key] of fields){if(form.elements['clear-'+key].checked)body[key]='';else if(form.elements[key].value)body[key]=form.elements[key].value;}return body;}
  root.querySelectorAll('[data-test]').forEach(button=>button.onclick=async()=>{const id=button.dataset.test;const out=button.closest('[data-service]').querySelector('[data-result]');button.disabled=true;out.textContent='Checking…';try{const j=await request('/test',{method:'POST',headers,body:JSON.stringify({...connectionPatch(id),connection:id})});if(alive)out.textContent=j.message;}catch(e){if(alive)out.textContent=e.message;}finally{if(alive)button.disabled=false;}});
  form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;status.textContent='Saving…';let body={siteTitle:form.elements.siteTitle.value,modules:{storage:form.elements.storage.checked,cloudflare:form.elements.cloudflare.checked},alerts:Object.fromEntries(['usagePct','tempC','intervalMin'].map(key=>[key,Number(form.elements[key].value)])),integrations:{}};
   for(const [id] of SERVICES){const patch=connectionPatch(id);body={...body,...patch,integrations:{...body.integrations,...patch.integrations}};}
   try{await request('',{method:'PUT',headers,body:JSON.stringify(body)});if(alive){for(const [, ,fields] of SERVICES)for(const [key] of fields)form.elements[key].value='';await load();root.querySelector('[data-status]').textContent='Saved. Reload Dokploy to update the menu and tab title.';}}catch(e){if(alive){status.textContent=e.message;button.disabled=false;}}
  };
 loadUpdate(s.owner);
 }catch(e){if(alive)root.innerHTML=alertBlock('error',esc(e.message));}}
 // ---- updates: one click when installed as a Dokploy Raw compose, otherwise the command to run.
 function updateView(u,owner){
  const v=esc(u.latest?.version||''),check=`<button type="button" class="${C.btnOutlineSm}" data-check>${icon('refresh','size-4')}Check again</button>`;
  if(!u.enabled)return `<p class="${C.small}">Version ${esc(u.current)}. Update checks are disabled (UPDATE_CHECK=off).</p>`;
  if(u.error)return `<p>Version ${esc(u.current)}. ${esc(u.error)}</p><div>${check}</div>`;
  if(!u.available)return `<div class="flex flex-wrap items-center gap-3"><p>Dokploy Plus ${esc(u.current)} is up to date.</p>${check}</div>`;
  const notes=u.latest.notes?`<details><summary class="cursor-pointer">What's new in ${v}</summary><pre class="${C.small}" style="white-space:pre-wrap;margin-top:8px">${esc(u.latest.notes)}</pre></details>`:'';
  const action=!owner?`<p class="${C.small}">Only the Dokploy owner can update.</p>`
   :u.managed?`<div><button type="button" class="${C.btnPrimary}" data-apply>Update to ${v}</button></div><p class="${C.small}">Dokploy redeploys the “${esc(u.managed.name)}” compose service. The extension is unavailable for a few seconds and the page reloads when ${v} answers.</p>`
   :`<p class="${C.small}">This install is not managed by a Dokploy Raw compose service. In the Dokploy Plus folder on the server, run:</p><pre class="${C.small}" style="white-space:pre-wrap"><code>git pull && docker compose pull && docker compose up -d</code></pre>${u.locateError?`<p class="${C.small}">${esc(u.locateError)}</p>`:''}`;
  return `<p class="font-medium">Version ${v} is available <span class="${C.small}">(installed: ${esc(u.current)})</span></p>${notes}${action}<p class="${C.small}" data-update-status role="status"></p>`;
 }
 async function loadUpdate(owner,force=false){
  const box=root.querySelector('[data-update]');if(!box)return;
  try{const r=await api('/update'+(force?'?refresh':''));const u=await r.json();if(!r.ok)throw new Error(u.error||`HTTP ${r.status}`);if(!alive)return;
   box.innerHTML=updateView(u,owner);
   box.querySelector('[data-check]')?.addEventListener('click',()=>{box.innerHTML=`<p class="${C.small}">Checking for updates…</p>`;loadUpdate(owner,true);});
   box.querySelector('[data-apply]')?.addEventListener('click',e=>applyUpdate(u,e.currentTarget));
  }catch(e){if(alive)box.innerHTML=`<p class="${C.small}">Update check failed: ${esc(e.message)}</p>`;}
 }
 async function applyUpdate(u,button){
  const out=root.querySelector('[data-update-status]');const say=t=>{if(alive&&out)out.textContent=t;};
  if(!confirm(`Update Dokploy Plus to ${u.latest.version}? Dokploy will redeploy the extension.`))return;
  button.disabled=true;say('Starting the update…');
  try{const r=await api('/update/apply',{method:'POST',headers,body:'{}'});const j=await r.json();if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
   say(`Dokploy is deploying ${j.to}…`);
   for(const until=Date.now()+300000;alive&&Date.now()<until;){await new Promise(res=>setTimeout(res,3000));
    try{const h=await(await fetch('/_ext/health',{cache:'no-store'})).json();if(h.version===j.to){say(`Updated to ${j.to}. Reloading…`);setTimeout(()=>location.reload(),800);return;}}catch{}}
   say('The new version has not answered after 5 minutes. Check the deployment in Dokploy, then reload the page.');
  }catch(e){say(e.message);button.disabled=false;}
 }
 load();return()=>{alive=false;};
}
