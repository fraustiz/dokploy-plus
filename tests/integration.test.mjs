import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';
const baseDir=fs.mkdtempSync(os.tmpdir()+'/dokploy-plus-test-');process.env.DATA_DIR=baseDir;
const Settings=await import('../proxy/lib/settings.mjs');const Config=await import('../proxy/lib/config.mjs');const Kuma=await import('../proxy/lib/uptime-kuma.mjs');const Dashboard=await import('../proxy/lib/dashboard.mjs');
test.after(()=>fs.rmSync(baseDir,{recursive:true,force:true}));
test('settings reject malformed URLs and out-of-range alerts without storing a patch',()=>{
 const before=JSON.stringify(Config.publicView());assert.throws(()=>Settings.validate({alerts:{usagePct:100}}));assert.throws(()=>Settings.validate({integrations:{beszel:{url:'https://user:pass@example.test'}}}));assert.throws(()=>Settings.validate({integrations:{beszel:{url:'javascript:alert(1)'}}}));assert.equal(JSON.stringify(Config.publicView()),before);
 Config.setSecret('beszelPassword','synthetic-sensitive-value');assert.ok(!JSON.stringify(Settings.view()).includes('synthetic-sensitive-value'));assert.ok(!fs.readFileSync(baseDir+'/config.json','utf8').includes('synthetic-sensitive-value'));
});
test('Kuma metrics parse statuses, SSL, 24-hour uptime and escaped labels without leaking URL credentials',()=>{
 const labels='monitor_id="1",monitor_name="Service \\"quoted\\"",monitor_url="https://user:pass@example.test/path?token=private"';
 const rows=Kuma.parse(`monitor_status{${labels}} 1\nmonitor_cert_days_remaining{${labels}} 30\nmonitor_uptime_ratio{${labels},window="1d"} 0.999\nmonitor_response_time{${labels}} 12.3\nmonitor_response_time{monitor_id="2"} NaN`);
 assert.equal(rows.length,1);assert.equal(rows[0].status,'up');assert.equal(rows[0].pingMs,12.3);assert.equal(rows[0].certificateDays,30);assert.equal(rows[0].uptime24h,99.9);assert.ok(!JSON.stringify(rows).includes('private'));assert.equal(rows[0].url,'https://example.test/path');
});
const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',r));const close=server=>new Promise(r=>server.close(r));
test('relay enforces session, owner and origin; Settings saves persist and branding is served as JS',async()=>{
 const up=http.createServer((req,res)=>{if(req.url.includes('user.get')){res.setHeader('content-type','application/json');res.end(JSON.stringify({result:{data:{json:{role:req.headers.cookie?.includes('owner')?'owner':'admin'}}}}));}else{res.setHeader('content-type','text/html');res.end('<html><head><title>Dokploy</title></head><body>Application</body></html>');}});await listen(up);
 const reservation=http.createServer();await listen(reservation);const port=reservation.address().port;await close(reservation);
 const child=spawn(process.execPath,['proxy/server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),DATA_DIR:baseDir+'/relay',DOKPLOY_URL:`http://127.0.0.1:${up.address().port}`,TRAEFIK:'off',AGENT_URL:'http://127.0.0.1:1'},stdio:'ignore'});
 const base=`http://127.0.0.1:${port}`;
 try{
  let ready=false;for(let i=0;i<200;i++){try{if((await fetch(base+'/_ext/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,20));}assert.ok(ready,'relay starts');
  assert.equal((await fetch(base+'/_ext/api/settings')).status,401);
  const save=(cookie,origin,body)=>fetch(base+'/_ext/api/settings',{method:'PUT',headers:{cookie,origin,'x-ext-csrf':'1','content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await save('admin=yes',base,{siteTitle:'Test'})).status,403);assert.equal((await save('owner=yes','https://wrong.test',{siteTitle:'Test'})).status,403);
  assert.equal((await save('owner=yes',base,{siteTitle:'Example',uptimeKumaKey:'synthetic-key',integrations:{uptimekuma:{url:'http://127.0.0.1:1234'}}})).status,200);
  const response=await(await fetch(base+'/_ext/api/settings',{headers:{cookie:'owner=yes'}})).json();assert.equal(response.siteTitle,'Example');assert.equal(response.connections.uptimekuma.saved.uptimeKumaKey,true);assert.ok(!JSON.stringify(response).includes('synthetic-key'));
  assert.ok((await(await fetch(base+'/_ext/static/branding.js')).text()).includes('Example'));
  const html=await(await fetch(base+'/',{headers:{accept:'text/html'}})).text();assert.ok(html.includes('/_ext/static/loader.js'));assert.ok(html.includes('/_ext/static/branding.js'));
 }finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await close(up);}
});
test('Kuma monitors attach to dashboard cards by host and path, or by a unique host',()=>{
 const apps=[{id:'a',url:'https://app.example.test'},{id:'b',url:'https://other.example.test/sub/'},{id:'c',url:'https://unmonitored.example.test/'},{id:'d',url:'https://admin.example.test/'},{id:'e',url:'https://shared.example.test/'}];
 const monitors=[{url:'https://app.example.test/',status:'up',uptime24h:99.5,pingMs:12,certificateDays:40,certificateValid:true},{url:'https://other.example.test/sub',status:'down'},{status:'up'},{url:'https://admin.example.test/admin/',status:'up'},{url:'https://shared.example.test/one',status:'up'},{url:'https://shared.example.test/two',status:'down'}];
 const h=Dashboard.matchHealth(apps,monitors);
 assert.deepEqual(Object.keys(h).sort(),['a','b','d']);assert.equal(h.a.status,'up');assert.equal(h.a.uptime24h,99.5);assert.equal(h.b.status,'down');assert.ok(!('url' in h.a));
});
test('temperature limits: Settings value for hard disks, drive limit or 70 °C for SSD/NVMe',async()=>{
 const {tempLimit}=await import('../proxy/lib/alerts.mjs');
 assert.equal(tempLimit({name:'sda',rotational:true,smart:{temperature_limit_c:60}},55),55);
 assert.equal(tempLimit({name:'nvme0n1',rotational:false,smart:{temperature_limit_c:83}},55),83);
 assert.equal(tempLimit({name:'nvme0n1',rotational:false,smart:{}},55),70);
 assert.equal(tempLimit({name:'sdc',rotational:false,smart:{temperature_limit_c:null}},55),70);
});
test('one-click update pins our images in the Raw compose and asks Dokploy to redeploy it',async()=>{
 const file='services:\n  relay:\n    image: ghcr.io/fraustiz/dokploy-plus/proxy:v0.11.3\n  agent:\n    image: "ghcr.io/fraustiz/dokploy-plus/agent"\n  db:\n    image: postgres:18\n';
 const calls=[];
 const dokploy=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  const u=new URL(req.url,'http://x');const name=u.pathname.split('/').pop();calls.push({name,method:req.method,cookie:req.headers.cookie,body:body&&JSON.parse(body).json});
  const input=u.searchParams.get('input')&&JSON.parse(u.searchParams.get('input')).json;
  const data=name==='project.all'?[{environments:[{compose:[{composeId:'other'},{composeId:'mine'}]}]}]
   :name==='compose.one'?(input.composeId==='mine'?{composeId:'mine',name:'dokploy-plus',sourceType:'raw',composeFile:file}:{composeId:'other',name:'db',sourceType:'raw',composeFile:'services: {}'}):{ok:true};
  res.setHeader('content-type','application/json');res.end(JSON.stringify({result:{data:{json:data}}}));});});
 const github=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({tag_name:'v0.12.0',html_url:'https://example.test/r',body:'Notes',published_at:'2026-11-14T00:00:00Z'}));});
 await listen(dokploy);await listen(github);
 process.env.DOKPLOY_URL=`http://127.0.0.1:${dokploy.address().port}`;process.env.UPDATE_API=`http://127.0.0.1:${github.address().port}`;
 try{
  const U=await import('../proxy/lib/update.mjs');
  assert.ok(U.newer('0.12.0','0.11.3'));assert.ok(!U.newer('0.11.3','0.11.3'));assert.ok(U.newer('0.11.10','0.11.9'));
  const req={headers:{cookie:'session=owner',host:'dokploy.example.test'}};
  const st=await U.status(req,'0.11.3',{role:'owner'});assert.equal(st.available,true);assert.equal(st.latest.version,'0.12.0');assert.deepEqual(st.managed,{name:'dokploy-plus'});
  const adminView=await U.status(req,'0.11.3',{role:'admin'});assert.equal(adminView.managed,null);
  calls.length=0;const r=await U.apply(req,'0.11.3');assert.deepEqual(r,{ok:true,from:'0.11.3',to:'0.12.0',compose:'dokploy-plus'});
  const update=calls.find(c=>c.name==='compose.update'),deploy=calls.find(c=>c.name==='compose.deploy');
  assert.equal(update.method,'POST');assert.equal(update.cookie,'session=owner');assert.equal(update.body.composeId,'mine');
  assert.ok(update.body.composeFile.includes('image: ghcr.io/fraustiz/dokploy-plus/proxy:v0.12.0\n'));assert.ok(update.body.composeFile.includes('image: "ghcr.io/fraustiz/dokploy-plus/agent:v0.12.0"'));assert.ok(update.body.composeFile.includes('image: postgres:18'));
  assert.deepEqual(deploy.body,{composeId:'mine'});
  assert.ok(!calls.some(c=>c.name==='project.all'),'remembered compose is reused');
  await assert.rejects(U.apply(req,'0.12.0'),/Already up to date/);
 }finally{await close(dokploy);await close(github);}
});
test('deployments: newest first, failing = services whose last deployment failed, previews and backups excluded',async()=>{
 const D=await import('../proxy/lib/deployments.mjs');
 const env={environmentId:'e1',name:'production',project:{projectId:'p1',name:'Web'}};
 const list=[
  {deploymentId:'1',applicationId:'a1',application:{name:'Site',environment:env},status:'error',title:'fix: one\nmore',errorMessage:'build failed',createdAt:'2026-11-14T10:00:00Z'},
  {deploymentId:'2',applicationId:'a1',application:{name:'Site',environment:env},status:'done',title:'fix: two',createdAt:'2026-11-14T11:00:00Z',finishedAt:'2026-11-14T11:01:00Z'},
  {deploymentId:'3',composeId:'c1',compose:{name:'Stack',environment:env},status:'error',title:'Manual deployment',createdAt:'2026-11-14T09:00:00Z'},
  {deploymentId:'4',applicationId:'a1',application:{name:'Site',environment:env},status:'error',isPreviewDeployment:true,createdAt:'2026-11-14T12:00:00Z'},
  {deploymentId:'5',backupId:'b1',status:'error',createdAt:'2026-11-14T13:00:00Z'}];
 const r=D.summarize(list);
 assert.deepEqual(r.recent.map(x=>x.id),['2','1','3']);assert.deepEqual(r.failing.map(x=>x.service),['Stack']);
 assert.equal(r.recent[1].title,'fix: one');assert.equal(r.recent[0].link,'/dashboard/project/p1/environment/e1/services/application/a1');assert.equal(r.recent[2].link,'/dashboard/project/p1/environment/e1/services/compose/c1');
});
test('Radarr picks the next release inside the window; Pi-hole list entries are validated before any request',async()=>{
 const A=await import('../proxy/lib/arr.mjs');const P=await import('../proxy/lib/pihole.mjs');
 const start=new Date('2026-11-14T00:00:00Z'),end=new Date('2026-11-21T00:00:00Z');
 const [m]=A.upcoming('radarr',[{title:'Film',inCinemas:'2026-07-01T00:00:00Z',physicalRelease:'2026-11-18T00:00:00Z',digitalRelease:'2026-11-16T00:00:00Z',hasFile:false}],start,end);
 assert.equal(m.detail,'Digital');assert.equal(m.at,'2026-11-16T00:00:00.000Z');
 const [e]=A.upcoming('sonarr',[{series:{title:'Show'},seasonNumber:2,episodeNumber:5,airDateUtc:'2026-11-15T20:00:00Z',hasFile:true}],start,end);
 assert.deepEqual(e,{title:'Show',detail:'S02E05',at:'2026-11-15T20:00:00Z',downloaded:true});
 await assert.rejects(P.addDomain({domain:'bad domain!',type:'allow',kind:'exact'}),/Invalid domain/);
 await assert.rejects(P.addDomain({domain:'ok.example',type:'everything',kind:'exact'}),/Invalid list/);
 await assert.rejects(P.setBlocking(false,5),/timer must be/);
});
test('Pi-hole: concurrent requests share one login, also after expiry, and wait out the 3 logins/second limit',async()=>{
 const P=await import('../proxy/lib/pihole.mjs');
 let logins=0,n=0,second=0,inSecond=0;const valid=new Set();
 const ph=http.createServer((req,res)=>{req.resume();req.on('end',()=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/api/auth'&&req.method==='POST'){
   const s=Math.floor(Date.now()/1000);if(s!==second){second=s;inSecond=0;}
   if(++inSecond>3){res.statusCode=429;return res.end(JSON.stringify({error:{key:'rate_limiting',message:'Rate-limiting login attempts'}}));}
   logins++;const sid='sid'+(++n);valid.add(sid);return res.end(JSON.stringify({session:{valid:true,sid}}));
  }
  if(req.url==='/api/auth'&&req.method==='DELETE'){valid.delete(req.headers['x-ftl-sid']);res.statusCode=204;return res.end();}
  if(!valid.has(req.headers['x-ftl-sid'])){res.statusCode=401;return res.end(JSON.stringify({error:{key:'unauthorized',message:'Unauthorized'}}));}
  res.end(JSON.stringify({queries:{total:10,blocked:1,percent_blocked:10},blocking:'enabled'}));
 });});await listen(ph);
 const base=`http://127.0.0.1:${ph.address().port}/admin/`;
 Config.update({integrations:{pihole:{url:base}}});Config.setSecret('piholePassword','app-pw');
 try{
  const [a,b]=await Promise.all([P.overview(),P.overview()]);
  assert.equal(logins,1);assert.equal(a.queries.total,10);assert.equal(b.blocking.state,'enabled');
  valid.clear();// the session expired
  const [,card]=await Promise.all([P.overview(),P.card(base,'app-pw')]);
  assert.equal(logins,2);assert.equal(card.percent,10);assert.equal(valid.size,1);
  valid.clear();second=Math.floor(Date.now()/1000);inSecond=3;// other clients used this second's logins
  assert.equal((await P.overview()).queries.blocked,1);assert.equal(logins,3);
  assert.match(await P.test(base,'app-pw'),/10% of 10/);assert.equal(valid.size,1);// test() logs its session out
 }finally{await close(ph);Config.update({integrations:{}});Config.setSecret('piholePassword','');}
});
