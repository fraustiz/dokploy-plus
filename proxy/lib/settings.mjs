import * as C from './config.mjs';
import * as CF from './cloudflare.mjs';
import * as Kuma from './uptime-kuma.mjs';
import * as Alerts from './alerts.mjs';
import * as Dashboard from './dashboard.mjs';
export const connections={cloudflare:{fields:['cloudflareToken']},jellyfin:{fields:['jellyfinToken'],url:true},homeassistant:{fields:['homeassistantToken'],url:true},beszel:{fields:['beszelEmail','beszelPassword'],url:true},uptimekuma:{fields:['uptimeKumaKey'],url:true},discord:{fields:['discordWebhook']}};
const error=message=>{const e=new Error(message);e.status=400;throw e;};
function url(value){let u;try{u=new URL(value);}catch{error('Invalid connection URL');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)error('Use an HTTP(S) base URL without credentials, query or fragment');return u.href.replace(/\/$/,'');}
export function view(){const cfg=C.load();return {...C.publicView(),siteTitle:cfg.siteTitle||process.env.SITE_TITLE||'',connections:Object.fromEntries(Object.entries(connections).map(([id,c])=>[id,{url:c.url?(cfg.integrations?.[id]?.url||cfg.dashboard?.apps.find(a=>a.integration===id)?.url||''):'',saved:Object.fromEntries(c.fields.map(f=>[f,!!C.secret(f)]))}]))};}
export function validate(body){const patch={};const secrets={};
 if(body.modules){patch.modules={};for(const k of ['storage','cloudflare'])if(k in body.modules){if(typeof body.modules[k]!=='boolean')error('Module state must be true or false');patch.modules[k]=body.modules[k];}}
 if(body.alerts){patch.alerts={};for(const [k,min,max] of [['usagePct',50,99],['tempC',30,90],['intervalMin',1,1440]])if(k in body.alerts){const n=Number(body.alerts[k]);if(!Number.isFinite(n)||n<min||n>max)error(`${k} must be between ${min} and ${max}`);patch.alerts[k]=n;}}
 if('siteTitle' in body){if(typeof body.siteTitle!=='string'||body.siteTitle.length>80)error('Title must be at most 80 characters');patch.siteTitle=body.siteTitle.trim();}
 if(body.integrations){patch.integrations={...(C.load().integrations||{})};for(const [id,entry] of Object.entries(body.integrations)){if(!connections[id]?.url)error('Unknown integration');patch.integrations[id]={url:entry.url?url(entry.url):''};}}
 for(const f of Object.values(connections).flatMap(c=>c.fields))if(f in body){if(typeof body[f]!=='string'||body[f].length>8192)error('Invalid credential');secrets[f]=body[f].trim();}
 if(secrets.discordWebhook&&!/^https:\/\/(discord\.com|discordapp\.com|canary\.discord\.com|ptb\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(secrets.discordWebhook))error('Invalid Discord webhook URL');
 return {patch,secrets};
}
async function get(base,path,headers={}){const r=await fetch(base+path,{headers,redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error(`Connection returned HTTP ${r.status}`);return r.json();}
export async function test(id,body){if(!connections[id])error('Unknown integration');const {patch,secrets}=validate(body);const secret=f=>f in secrets?secrets[f]:C.secret(f);const base=patch.integrations?.[id]?.url||view().connections[id].url;
 if(connections[id].url&&!base)error('Enter the service URL first');
 if(id==='cloudflare'){if(!secret('cloudflareToken'))error('Cloudflare token required');const r=await CF.verifyToken(secret('cloudflareToken'));return `Connected. ${r.zones.length} zones available.`;}
 if(id==='jellyfin'){const info=await get(base,'/System/Info/Public');if(secret('jellyfinToken'))await get(base,'/Sessions',{Authorization:`MediaBrowser Token="${secret('jellyfinToken')}"`});return `Jellyfin ${info.Version} reachable.${secret('jellyfinToken')?' Authenticated access verified.':' Add a token to show active playback.'}`;}
 if(id==='homeassistant'){if(!secret('homeassistantToken'))error('Home Assistant token required');const info=await get(base,'/api/config',{Authorization:'Bearer '+secret('homeassistantToken')});return `Home Assistant ${info.version} connected.`;}
 if(id==='beszel'){if(!secret('beszelEmail')||!secret('beszelPassword'))error('Beszel account email and password required');const r=await getAuthBeszel(base,secret('beszelEmail'),secret('beszelPassword'));return `Connected. ${r} systems available.`;}
 if(id==='uptimekuma'){const r=await Kuma.metrics(base,secret('uptimeKumaKey'));if(!r.configured)error('Uptime Kuma metrics API key required');return `Connected. ${r.monitors.length} monitors available.`;}
 if(id==='discord'){if(!secret('discordWebhook'))error('Discord webhook required');await Alerts.sendDiscord(secret('discordWebhook'),'Dokploy Plus',['Dokploy Plus connection test.']);return 'Test message sent.';}
}
async function getAuthBeszel(base,email,password){const r=await fetch(base+'/api/collections/users/auth-with-password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identity:email,password}),redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error(`Beszel login failed (HTTP ${r.status})`);const auth=await r.json();const data=await get(base,'/api/collections/systems/records?perPage=1&fields=id',{Authorization:auth.token});return data.totalItems;}
export async function handle(req,res,user,{json,readBody,version,traefik}){
 if(req.method==='GET')return json(res,200,{...view(),version,owner:user.role==='owner',traefik});
 if(user.role!=='owner')return json(res,403,{error:'Only the owner can change settings'});
 const body=await readBody(req,65536);
 if(req.method==='POST'&&req.url.split('?')[0].endsWith('/test'))return json(res,200,{ok:true,message:await test(body.connection,body)});
 if(req.method!=='PUT')return json(res,405,{error:'Method not allowed'});
 const {patch,secrets}=validate(body);for(const [key,value] of Object.entries(secrets))C.setSecret(key,value||null);C.update(patch);Dashboard.invalidate();
 return json(res,200,{...view(),version,owner:true,traefik});
}
