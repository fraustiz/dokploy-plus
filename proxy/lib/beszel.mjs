// Read Beszel through its PocketBase API with a dedicated read-only user.
import * as Config from './config.mjs';
let session=null;
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
export function sanitize(record,base) {
 const info=record.info||{};
 return {id:String(record.id),name:String(record.name||'Server'),status:String(record.status||'unknown'),updated:record.updated||null,
 cpu:number(info.cpu),memoryPct:number(info.mp),diskPct:number(info.dp),uptimeSeconds:number(info.u),
 url:base.replace(/\/$/,'')+'/system/'+encodeURIComponent(record.id)};
}
async function request(base,path,options={}) {
 const r=await fetch(base+path,{...options,redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!r.ok){const e=new Error(`Beszel HTTP ${r.status}`);e.status=r.status;throw e;}
 return r.json();
}
export async function systems(base) {
 const email=Config.secret('beszelEmail'),password=Config.secret('beszelPassword');
 if(!email||!password)return {online:null,configured:false,systems:[]};
 const key=base+'|'+email+'|'+password;
 if(!session||session.key!==key||session.until<Date.now()){
  const auth=await request(base,'/api/collections/users/auth-with-password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identity:email,password})});
  session={key,token:auth.token,until:Date.now()+3600000};
 }
 let rows=[];
 try {
  for(let page=1;page<=10;page++){
   const data=await request(base,`/api/collections/systems/records?page=${page}&perPage=100&fields=id,name,status,updated,info`,{headers:{Authorization:session.token}});
   rows.push(...data.items.map(r=>sanitize(r,base)));
   if(page>=data.totalPages)break;
  }
 }catch(e){if(e.status===401||e.status===403)session=null;throw e;}
 return {online:true,configured:true,systems:rows};
}
