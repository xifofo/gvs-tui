// Isolated integration only: real client/tunnel/gateway, synthetic upstream and accounts.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import dns from 'node:dns/promises'
import { GwClient } from '../src/lib/client.ts'
import { runTunnel } from '../src/lib/tunnel.ts'
import { defaultConfig } from '../src/lib/config.ts'
import { Runtime } from '../src/runtime.ts'
import { TencentRiskStop } from '../src/lib/tencent-risk.ts'
import { downloadPlaylist } from '../src/lib/media.ts'
import { lookM3u8dl, lookBundledFFmpeg } from '../src/lib/tools.ts'

const host=process.env.GVS_HOST!, key=process.env.GVS_KEY!, dir=process.env.GVS_PREFLIGHT_DIR!
if(process.env.GVS_PREFLIGHT!=='1'||!dir||!key||new URL(host).hostname!=='127.0.0.1') throw new Error('Isolated preflight environment required')
const calls:Array<{host:string,path:string,method:string}>=[]
const denied:string[]=[]
let pulls=0, mode:'success'|'risk'='success'
const realFetch=globalThis.fetch.bind(globalThis)
dns.resolve4=(async()=>['192.0.2.1']) as typeof dns.resolve4 // No external DNS; not Clash fake-IP.
const json=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}})
const tvHosts=new Set(['tv.video.qq.com','tv.ott.video.qq.com'])
globalThis.fetch=(async(input:any,init?:RequestInit)=>{
 const u=new URL(input instanceof Request?input.url:String(input))
 if(u.origin===host) return realFetch(input,init)
 calls.push({host:u.hostname,path:u.pathname,method:init?.method||'GET'})
 if(tvHosts.has(u.hostname)&&u.pathname==='/trpc.kt_st_multiscreen.uuid.UUID/GenerateWSID')return json({result:{code:0},wsids:['preflight-wsid']})
 if(tvHosts.has(u.hostname)&&u.pathname==='/i-tvbin/login/qrencode')return new Response(readFileSync(join(dir,'qr-fixture.png')),{headers:{'content-type':'image/png'}})
 if(tvHosts.has(u.hostname)&&u.pathname==='/i-tvbin/multiscreen/polling/pull'){
  pulls++;return json({result:{code:0},delay:1,msgs:pulls===1?[]:[{recv_seq:4,category:'tv_web',type:'msg',msg:{type:'scanreport',msg:{info:JSON.stringify({ret:0,event:2,access_token:'PREFLIGHT-SECRET-AT',vusession:'PREFLIGHT-SECRET-VU',vuserid:'1',kt_login:'wx'})}}}]})
 }
 if(u.hostname==='tv.aiseet.atianqi.com'&&u.pathname==='/i-tvbin/qtv_video/search/get_search_smart_box')return json({data:{search_data:{vecGroupData:[{group_data:[{cell_info:{id:'mzcpreflight001',title:'Offline Fixture Series',img_tips:'Offline Fixture Series'}}]}]}}})
 if(u.hostname==='v.qq.com'&&['/x/hotlist','/x/hotlist/','/biu/ranks'].includes(u.pathname))return new Response('<div class="mod_rank_wrap"><div class="mod_rank_title"><h3>Fixture</h3></div><ol class="hotlist"><li><a title="Offline Fixture Series" href="/x/cover/mzcpreflight001.html">Fixture</a></li></ol></div>')
 if(u.hostname==='pbaccess.video.qq.com'&&u.pathname==='/trpc.universal_backend_service.page_server_rpc.PageServer/GetPageData')return json({data:{module_list_datas:[{module_datas:[{module_params:{module_type:'episode_list'},item_data_lists:{item_datas:[{item_type:'1',item_params:{vid:'offlinevid01',play_title:'第38集',cover_c_title:'Offline Fixture Series'}}]}}]}]}})
 if(u.hostname==='h.trace.qq.com'&&u.pathname==='/bosskv'){
  const headers=new Headers(init?.headers);assert.equal(headers.get('cookie'),null)
  const form=new URLSearchParams(String(init?.body instanceof Uint8Array?Buffer.from(init.body).toString():init?.body||''));assert.equal(form.get('token'),'PREFLIGHT-SECRET-COLLECTOR')
  return json({ret:0})
 }
 if(u.hostname==='tv.aiseet.atianqi.com'&&u.pathname==='/trpc.kt_user_behavior.intelligent_decision.Decision/GetFeature')return json({ret:0,msg:''})
 if(u.hostname==='vv.play.aiseet.atianqi.com'&&u.pathname==='/checktime')return json({t:1700000000})
 if(u.hostname==='vv.play.aiseet.atianqi.com'&&u.pathname==='/getvinfo'){
  if(mode==='risk')return json({em:93,code:93.2,msg:'限制播放',retry:0})
  return json({em:0,msg:'ok',fl:{fi:[{id:10201,name:'hd',cname:'Fixture HD',width:1280,height:720,profile:'h264',lmt:0}]},vl:{vi:[{vid:'offlinevid01',ti:'Offline Fixture',vw:1280,vh:720,td:2,defn:'hd',enc:'0',ul:{ui:[{url:host+'/preflight/',hls:{pt:'fixture.m3u8'}}]}}]}})
 }
 if(u.hostname==='media.preflight.invalid'&&u.pathname==='/fixture.m3u8')return new Response(['#EXTM3U','#EXT-X-TARGETDURATION:1','#EXTINF:1,','segment.ts','#EXT-X-ENDLIST',''].join(String.fromCharCode(10)))
 if(u.hostname==='media.preflight.invalid'&&u.pathname==='/segment.ts')return new Response(new Uint8Array(188*4).fill(0x47))
 denied.push(u.hostname+u.pathname);throw new Error('PREFLIGHT_UPSTREAM_NOT_ALLOWLISTED '+u.hostname+u.pathname)
}) as typeof fetch
const cfg={...defaultConfig(),host,key,tencentMode:'tv' as const,tencentObservations:true,outDir:join(dir,'outputs')}
const client=new GwClient(host,key,()=>cfg)
const abort=new AbortController()
let tunnelReady=false, tunnelError=''
runTunnel(host,key,(ok,error)=>{tunnelReady=ok;tunnelError=error},abort.signal)
const wait=async(check:()=>boolean,label:string,ms=10000)=>{const started=Date.now();while(!check()){if(Date.now()-started>ms)throw new Error(label+' timed out '+tunnelError);await Bun.sleep(50)}}
const stages:string[]=[]
try{
 await wait(()=>tunnelReady,'loopback tunnel')
 const info=await client.keyInfo();assert(info.scope?.includes('tencent'));stages.push('real_gateway_auth_and_scope')
 const unauth=await realFetch(host+'/v1/key');assert.equal(unauth.status,401);stages.push('unauthenticated_rejected')
 const profile={method:'tv',session_type:'tv',tvid:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',qua_info:'QV=1&PR=VIDEO&PT=SNMAPP&CHID=16118&VN=20.0.0&VN_CODE=1274006&TVKPlatform=670603',appver:'20.0.0.1008'}
 const qr=await client.invoke('tencent','login',profile);assert.equal(qr.logged_in,false);stages.push('synthetic_issuer_qr_and_pending_state')
 let confirmed=false
 for(let i=0;i<6&&!confirmed;i++){await Bun.sleep(1100);const state=await client.invoke('tencent','login',{method:'tv',session_type:'tv',state:'check'});confirmed=state.logged_in===true}
 assert(confirmed);stages.push('synthetic_scan_confirmation_and_session_save')
 const n=calls.length;await client.invoke('tencent','login',{method:'tv',session_type:'tv',state:'check'});assert.equal(calls.length,n);stages.push('confirmed_session_no_extra_login')
 const gateBefore=calls.length
 const binding=await client.invoke('tencent','report',{session_type:'tv',report_type:'bind',flow_id:'preflight-gate-flow'})
 const disabled=await client.invoke('tencent','report',{session_type:'tv',report_type:'bosskv',payload:JSON.stringify({step:0}),binding:binding.binding,send:'1'})
 if(process.env.GVS_PREFLIGHT_REPORTS==='1'){
  assert.equal(disabled.status,'unverified_response');assert.equal(disabled.sent,true);assert.equal(disabled.acknowledged,false);assert.equal(calls.length,gateBefore+1);stages.push('bosskv_real_serialization_tunnel_fixture_response')
  const schema=JSON.parse(readFileSync(join(import.meta.dir,'../../gateway/internal/provider/tencent/testdata/tv_report_capture_schema.json'),'utf8'))
  const features=Object.fromEntries(Object.entries(schema.feature_types).map(([k,v])=>[k,v==='number'?0:v==='boolean'?false:v==='object'?{}:'']))
  const feature=await client.invoke('tencent','report',{session_type:'tv',report_type:'getfeature',payload:JSON.stringify({scene:'start_up',uuid:'fixture-device-uuid',features}),binding:binding.binding,send:'1'})
  assert.equal(feature.sent,true);assert.equal(feature.acknowledged,false);assert.deepEqual(feature.response_zero_fields,['ret']);stages.push('getfeature_real_serialization_tunnel_fixture_response')
 }else{assert.equal(disabled.status,'disabled');assert.equal(disabled.sent,false);assert.equal(calls.length,gateBefore);stages.push('report_disabled_no_upstream_request')}
 const rejectedScopeBefore=calls.length;await assert.rejects(()=>client.invoke('youku','capabilities',{}),/ROUTE_FORBIDDEN|forbidden/i);assert.equal(calls.length,rejectedScopeBefore);stages.push('cross_provider_scope_rejected_before_upstream')

 const search=await client.invoke('tencent','search',{q:'Offline Fixture Series',session_type:'tv'});assert.equal((search.items as any[]).length,1);assert.equal((search.items as any[])[0].title,'Offline Fixture Series');stages.push('search_real_parser')
 const detail=await client.invoke('tencent','detail',{cid:'mzcpreflight001',session_type:'tv'});assert.equal((detail.episodes as any[]).length,1);stages.push('detail_real_parser')
 const job=client.forkTencentJob(1,'offlinevid01')
 const play=await job.invoke('tencent','play',{vid:'offlinevid01',cid:'mzcpreflight001',session_type:'tv'});assert.equal(play.has_url,true);stages.push('play_real_provider_and_signer')
 const playlist=String(play.url||play.playlist_url);assert.equal(new URL(playlist).origin,host)
 assert(lookM3u8dl(),'local downloader required; no downloads allowed');assert(lookBundledFFmpeg(),'local ffmpeg required')
 const downloaded=join(dir,'downloaded.ts')
 await downloadPlaylist({src:playlist,dest:downloaded,ref:'',clear:true,threads:1,transport:'node',workDir:join(dir,'media-work'),signal:AbortSignal.timeout(20000)})
 const bytes=statSync(downloaded).size;assert(bytes>0)
 const decoded=Bun.spawnSync([lookBundledFFmpeg(),'-v','error','-i',downloaded,'-f','null','-'],{stdout:'pipe',stderr:'pipe'});assert.equal(decoded.exitCode,0,'downloaded synthetic media must decode')
 job.observeTencentTransfer(bytes,bytes);await job.closeTencentTransfer();stages.push('real_hls_downloader_and_ffmpeg_synthetic_media_decode')
 // New explicit operation, then one upstream rejection. Never restart automatically.
 await client.invoke('tencent','search',{q:'Offline Fixture Series',session_type:'tv'});mode='risk'
 const before=calls.filter(c=>c.path==='/getvinfo').length
 await assert.rejects(()=>client.invoke('tencent','play',{vid:'offlinevid01',session_type:'tv'}),
  (error: unknown)=>error instanceof TencentRiskStop && error.risk.code==='93' && error.risk.stop)
 const after=calls.filter(c=>c.path==='/getvinfo').length;assert.equal(after-before,1)
 const requestsAfterRejection=calls.length
 await assert.rejects(()=>client.invoke('tencent','play',{vid:'offlinevid01',session_type:'tv'}),/stopped after rejection/)
 assert.equal(calls.length,requestsAfterRejection,'a rejected flow must not send reports or retry upstream')
 assert.equal(calls.filter(c=>c.path==='/getvinfo').length,after);stages.push('risk_rejection_single_request_and_no_retry')
 // A separate explicit UI scenario uses the real Runtime, not simulate/demo.
 mode='success';abort.abort();await Bun.sleep(200)
 mkdirSync(join(dir,'gvs'),{recursive:true});writeFileSync(join(dir,'gvs','tui.json'),JSON.stringify(cfg))
 const runtime=new Runtime();runtime.resize(120,36)
 try{
  await wait(()=>runtime.snapshot.scene==='workspace'&&!runtime.snapshot.busy,'real Runtime bootstrap',20000)
  runtime.handleKey('f2');runtime.set('query','Offline Fixture Series');runtime.handleKey('enter')
  await wait(()=>runtime.snapshot.scene==='results'&&!runtime.snapshot.busy,'Runtime search')
  assert.equal(runtime.snapshot.rows?.[0]?.title,'Offline Fixture Series')
  runtime.handleKey('home');runtime.handleKey('enter')
  await wait(()=>runtime.snapshot.scene==='detail'&&!runtime.snapshot.busy,'Runtime detail')
  assert.equal(runtime.snapshot.episodes?.[0]?.vid,'offlinevid01')
  runtime.handleKey('c');runtime.handleKey('home');runtime.handleKey('space');runtime.handleKey('enter')
  await wait(()=>runtime.snapshot.scene==='quality'&&!runtime.snapshot.busy,'Runtime play probe')
  assert.equal(runtime.snapshot.probeFailed,false,String(runtime.snapshot.status));assert.equal(runtime.snapshot.jobs.length,0)
  runtime.handleKey('esc');assert.equal(runtime.snapshot.jobs.length,0)
  stages.push('real_Runtime_keyboard_search_detail_play_and_escape_no_job')
  runtime.handleKey('enter');await wait(()=>runtime.snapshot.scene==='quality'&&!runtime.snapshot.busy,'Runtime second explicit probe')
  runtime.handleKey('enter');await wait(()=>runtime.snapshot.scene==='confirm'&&!runtime.snapshot.busy,'Runtime confirmation page')
  runtime.handleKey('enter');runtime.handleKey('enter');assert.equal(runtime.snapshot.jobs.length,1)
  await wait(()=>['完成','失败'].includes(runtime.snapshot.jobs[0]?.status||''),'real queued download',30000)
  const completed=runtime.snapshot.jobs[0]!;assert.equal(completed.status,'完成',completed.err)
  assert.equal(completed.err,'');assert(statSync(completed.log).size>0)
  const finalDecode=Bun.spawnSync([lookBundledFFmpeg(),'-v','error','-i',completed.log,'-f','null','-'],{stdout:'pipe',stderr:'pipe'});assert.equal(finalDecode.exitCode,0,'final queued output must decode')
  stages.push('real_Runtime_confirm_queue_mux_output_and_duplicate_enter_guard')

 }finally{runtime.close();await Bun.sleep(200)}
 assert.equal(denied.length,0);assert(!calls.some(c=>c.path.includes('auth_refresh')));stages.push('no_implicit_auth_refresh')
 const result={mode:'isolated_synthetic_upstream_real_client_gateway_tunnel',stages,upstream_requests:calls,unknown_requests:denied,real_platform_requests:0,new_accounts_used:0,report_send_fixture_enabled:process.env.GVS_PREFLIGHT_REPORTS==='1',limitations:['Synthetic upstream responses cannot verify Tencent acceptance or prevent future risk controls.','Synthetic clear HLS was downloaded and decoded; real content and DRM are not validated.','Real GwClient and Runtime key handlers are exercised; terminal rendering is not asserted.']}
 writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('PREFLIGHT_PASS',stages.length)
}catch(error){writeFileSync(join(dir,'failure.json'),JSON.stringify({stages,message:String(error).replaceAll(key,'[KEY]').slice(0,700),denied},null,2));process.exitCode=1}finally{abort.abort();await Bun.sleep(150)}
process.exit(process.exitCode||0)
