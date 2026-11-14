// Reads Dokploy's own API with the caller's session. Never returns service credentials.
const upstream = new URL(process.env.DOKPLOY_UPSTREAM || process.env.DOKPLOY_URL || 'http://dokploy:3000');
async function rpc(req,name,input) {
 const url=new URL('/api/trpc/'+name,upstream);
 if(input)url.searchParams.set('input',JSON.stringify({json:input}));
 const r=await fetch(url,{headers:{cookie:req.headers.cookie||'',host:req.headers.host||upstream.host,'x-forwarded-proto':'https'},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw new Error(`Dokploy ${name}: HTTP ${r.status}`);
 const body=await r.json();return body.result?.data?.json;
}
export function summarize(service,kind,project) {
 const backups=[...(service.backups||[]),...(service.volumeBackups||[])];
 return backups.map(b=>{
  const runs=[...(b.deployments||[])].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const last=runs[0];const success=runs.find(d=>d.status==='done');
  return {id:b.backupId||b.volumeBackupId,name:service.name,kind,project,enabled:b.enabled,schedule:b.schedule||b.cronExpression||null,destination:b.destination?.name||null,lastStatus:last?.status||null,lastRun:last?.createdAt||null,lastSuccess:success?.createdAt||null};
 });
}
export async function summary(req) {
 const projects=await rpc(req,'project.all');
 if(!Array.isArray(projects))throw new Error('Unexpected Dokploy project response');
 const jobs=[];for(const p of projects)for(const env of p.environments||[])for(const kind of ['postgres','mysql','mongo','mariadb','libsql','compose','applications'])for(const service of env[kind]||[]){
 const type=kind==='applications'?'application':kind;const id=service[type+'Id'];if(id)jobs.push({type,id,project:p.name});
 }
 const rows=[],errors=[];let index=0;
 await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{while(index<jobs.length){const job=jobs[index++];try{const service=await rpc(req,job.type+'.one',{[job.type+'Id']:job.id});rows.push(...summarize(service||{},job.type,job.project));}catch(e){errors.push(e.message);}}}));
 return {backups:rows,errors,checkedAt:new Date().toISOString(),coverage:'Dokploy-managed backups only'};
}
