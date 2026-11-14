// Uses Uptime Kuma's authenticated Prometheus endpoint; no public status page required.
import * as Config from './config.mjs';
export function parse(text) {
 const monitors=new Map();
 for(const line of text.split('\n')){
  const match=line.match(/^(monitor_status|monitor_response_time|monitor_cert_days_remaining|monitor_cert_is_valid|monitor_uptime_ratio)\{(.*)\}\s+([-+\d.eE]+)(?:\s|$)/);
  if(!match)continue;const labels={};for(const l of match[2].matchAll(/([\w]+)="((?:\\.|[^"\\])*)"/g)){try{labels[l[1]]=JSON.parse('"'+l[2]+'"');}catch{}}
  const id=labels.monitor_id||labels.monitor_name;if(!id)continue;const value=Number(match[3]);if(!Number.isFinite(value))continue;
  if(!monitors.has(id))monitors.set(id,{id,name:labels.monitor_name||'Monitor',status:null,pingMs:null,certificateDays:null,certificateValid:null,uptime24h:null});
  const m=monitors.get(id);
  if(labels.monitor_url){try{const u=new URL(labels.monitor_url);if(['http:','https:'].includes(u.protocol)){u.username='';u.password='';u.search='';u.hash='';m.url=u.href;}}catch{}}
  if(match[1]==='monitor_status')m.status=({0:'down',1:'up',2:'pending',3:'maintenance'})[value]||'unknown';
  if(match[1]==='monitor_response_time')m.pingMs=value;
  if(match[1]==='monitor_cert_days_remaining')m.certificateDays=value;
  if(match[1]==='monitor_cert_is_valid')m.certificateValid=value===1;
  if(match[1]==='monitor_uptime_ratio'&&['1d','24h'].includes(labels.window))m.uptime24h=value*100; // Kuma 2.x: window="1d"
 }
 return [...monitors.values()];
}
export async function metrics(base,key=Config.secret('uptimeKumaKey')){
 if(!key)return {online:null,configured:false,monitors:[]};
 const r=await fetch(base.replace(/\/$/,'')+'/metrics',{headers:{Authorization:'Basic '+Buffer.from(':'+key).toString('base64')},redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw new Error(`Uptime Kuma HTTP ${r.status}`);
 return {online:true,configured:true,monitors:parse(await r.text())};
}
