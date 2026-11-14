import * as Kuma from "./uptime-kuma.mjs";
import * as Beszel from "./beszel.mjs";
import * as Config from './config.mjs';
import {randomUUID} from 'node:crypto';
const initial = {categories: ['Applications'], apps: []};
const fail = (message) => { const e = new Error(message); e.status = 400; throw e; };
const text = (v,max=120) => String(v || '').trim().slice(0,max);
function httpUrl(v) {
  let u; try {u=new URL(v);} catch {fail('Invalid URL');}
  if(!['http:','https:'].includes(u.protocol) || u.username || u.password) fail('HTTP(S) URLs without credentials required');
  return u.href;
}
export function validate(body) {
 const categories = [...new Set((body.categories || []).map(v=>text(v)).filter(Boolean))].slice(0,30);
 if(!categories.length) fail('At least one category required');
 if(!Array.isArray(body.apps) || body.apps.length>150) fail('Invalid app list');
 const apps=body.apps.map(a=>({id:/^[\w-]{1,80}$/.test(a.id)?a.id:randomUUID(),name:text(a.name),url:httpUrl(a.url),logo:a.logo?httpUrl(a.logo):'',category:categories.includes(a.category)?a.category:categories[0],integration:['jellyfin','homeassistant','beszel','uptimekuma'].includes(a.integration)?a.integration:'link',entities:(a.entities||[]).filter(v=>typeof v==='string' && /^[a-z_]+\.[\w]+$/.test(v)).slice(0,6)}));
 if(apps.some(a=>!a.name)) fail('An app name is required');
 if(new Set(apps.map(a=>a.id)).size!==apps.length) fail('Duplicate app IDs');
 return {categories,apps};
}
const cache = new Map();
async function getJSON(url,headers={}) {
 const r=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!r.ok) throw new Error(`HTTP ${r.status}`);
 return r.json();
}
export async function integration(app) {
 const hit=cache.get(app.id);if(hit && hit.until>Date.now())return hit.value;
 const at=new Date().toISOString();let value;
 try {
  const base=(Config.load().integrations?.[app.integration]?.url||app.url).replace(/\/$/,'');
  if(app.integration==='jellyfin') {
   const info=await getJSON(base+'/System/Info/Public');
   const token=Config.secret('jellyfinToken');
   let playing=null;
   if(token){const sessions=await getJSON(base+'/Sessions',{Authorization:`MediaBrowser Token="${token}"`});playing=sessions.filter(s=>s.NowPlayingItem).map(s=>({title:s.NowPlayingItem.Name,paused:!!s.PlayState?.IsPaused})).slice(0,8);}
   value={online:true,version:info.Version,playing,configured:!!token,at};
  } else if(app.integration==='homeassistant') {
   const token=Config.secret('homeassistantToken');
   if(!token) return {online:null,configured:false,at};
   const headers={Authorization:`Bearer ${token}`};
   const info=await getJSON(base+'/api/config',headers);
   const entities=await Promise.all(app.entities.map(async id=>{const s=await getJSON(base+'/api/states/'+encodeURIComponent(id),headers);return {name:s.attributes?.friendly_name||id,state:s.state,unit:s.attributes?.unit_of_measurement||''};}));
   value={online:true,version:info.version,entities,configured:true,at};
  } else if(app.integration==='beszel') {
   value={...(await Beszel.systems(base)),at};
  } else if(app.integration==='uptimekuma') {
   value={...(await Kuma.metrics(base)),at};
  } else return null;
 } catch(e) { value={online:false,error:e.message.startsWith('HTTP')?e.message:'Connection failed',at}; }
 cache.set(app.id,{until:Date.now()+30000,value});return value;
}
// Uptime Kuma status per card: same host + path as the card, otherwise the only monitor on that host
// (e.g. a card for https://pihole.example/ and a monitor on /admin/).
const parse=v=>{try{const u=new URL(v);return {host:u.host,key:u.host+u.pathname.replace(/\/+$/,'')};}catch{return null;}};
export function matchHealth(apps,monitors) {
 const rows=monitors.map(m=>({m,u:m.url&&parse(m.url)})).filter(r=>r.u);
 const pick=a=>{const u=parse(a.url);if(!u)return null;const same=rows.filter(r=>r.u.host===u.host);return (same.find(r=>r.u.key===u.key)||(same.length===1?same[0]:null))?.m;};
 return Object.fromEntries(apps.flatMap(a=>{const m=pick(a);return m?[[a.id,{status:m.status,uptime24h:m.uptime24h,pingMs:m.pingMs,certificateDays:m.certificateDays,certificateValid:m.certificateValid}]]:[];}));
}
async function health(cfg,apps) {
 const base=cfg.integrations?.uptimekuma?.url||apps.find(a=>a.integration==='uptimekuma')?.url;
 if(!base||!Config.secret('uptimeKumaKey'))return {};
 const hit=cache.get(':kuma');if(hit && hit.until>Date.now())return hit.value;
 let value={};
 try {value=matchHealth(apps,(await Kuma.metrics(base)).monitors);} catch {}
 cache.set(':kuma',{until:Date.now()+30000,value});return value;
}
export async function handle(req,res,url,user,{json,readBody}) {
 const cfg=Config.load();const c=cfg.dashboard||initial;
 if(req.method==='GET') {
  const [states,healthy]=await Promise.all([Promise.all(c.apps.filter(a=>a.integration!=='link').map(async a=>[a.id,await integration(a)])).then(Object.fromEntries),health(cfg,c.apps)]);
  return json(res,200,{...c,states,health:healthy,owner:user.role==='owner',tokens:{jellyfin:!!Config.secret('jellyfinToken'),homeassistant:!!Config.secret('homeassistantToken'),discord:!!Config.secret('discordWebhook'),beszel:!!Config.secret('beszelEmail')&&!!Config.secret('beszelPassword'),uptimekuma:!!Config.secret('uptimeKumaKey')}});
 }
 if(req.method!=='PUT')return json(res,405,{error:'Method not allowed'});
 if(user.role!=='owner')return json(res,403,{error:'Owner only'});
 const b=await readBody(req,65536);const config=validate(b);
 Config.update({dashboard:config});cache.clear();return json(res,200,{ok:true});
}

export function invalidate() { cache.clear(); }
