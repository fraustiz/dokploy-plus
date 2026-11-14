import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import * as Config from './config.mjs';
import {sendDiscord} from './alerts.mjs';
const file=(process.env.DATA_DIR||'/data')+'/incident-notifications.json';
let running=false;
export function start(agent) {
 const check=async()=>{
  if(running)return;running=true;
  try {
   const hook=Config.secret('discordWebhook');if(!hook)return;
   let since;try{since=JSON.parse(readFileSync(file,'utf8')).at;}catch{since=Date.now()/1000;}
   const r=await fetch(agent+'/insights',{signal:AbortSignal.timeout(20000)});if(!r.ok)return;const s=await r.json();
   const events=s.events.filter(e=>e.at>since);
   if(events.length)await sendDiscord(hook,'Containers',events.slice(-15).map(e=>`${e.resolved?'Recovered':'Incident'}: **${e.container.replace(/[*`@]/g,'')}** — ${e.kind}`));
   const at=events.length?Math.max(...events.map(e=>e.at)):since;
   writeFileSync(file+'.tmp',JSON.stringify({at}),{mode:0o600});renameSync(file+'.tmp',file);
  }catch(e){console.error('[incident alerts]',e.message);}finally{running=false;}
 };
 check();setInterval(check,60000).unref();
}
