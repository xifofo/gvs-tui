import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JobHub, type DlTask, type JobEvt } from './jobs'
import { lookPackager, lookBundledFFmpeg } from './tools'
import type { FileConfig } from './config'
import type { GwClient } from './client'

const mediaTest = process.env.GVS_MEDIA_TESTS === '1' ? test : test.skip

mediaTest('Apple TV HLS CBCS jobs decrypt separate content KIDs and publish verified MKV', async () => {
  const root = mkdtempSync(join(tmpdir(),'gvs-apple-tv-cbcs-'))
  const ffmpeg = lookBundledFFmpeg(), packager = lookPackager()
  const run = (bin:string,args:string[]) => {const r=spawnSync(bin,args,{cwd:root,encoding:'utf8',timeout:30000});if(r.status!==0)throw new Error(`media fixture command failed: ${r.error??r.stderr}`);return r.stdout}
  const video={kid:'00000000000000000000000000000001',key:'11111111111111111111111111111111'}
  const audio={kid:'00000000000000000000000000000002',key:'22222222222222222222222222222222'}
  const requested:string[]=[]
  const server=createServer((req,res)=>{requested.push(req.url||'');if(req.url?.startsWith('/master.m3u8')){res.writeHead(403).end();return}try{const file=readFileSync(join(root,new URL(req.url||'/','http://localhost').pathname));res.writeHead(200,{'Content-Length':String(file.length)}).end(file)}catch{res.writeHead(404).end()}})
  const events:JobEvt[]=[];const hub=new JobHub(e=>events.push(e))
  try {
    run(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=10','-f','lavfi','-i','sine=sample_rate=48000','-t','3','-c:v','libx264','-preset','ultrafast','-g','10','-c:a','aac','source.mp4'])
    run(packager,['in=source.mp4,stream=video,init_segment=video-init.mp4,segment_template=video-$Number$.m4s,playlist_name=video.m3u8,drm_label=VIDEO','in=source.mp4,stream=audio,init_segment=audio-init.mp4,segment_template=audio-$Number$.m4s,playlist_name=audio.m3u8,hls_group_id=audio,hls_name=English,drm_label=AUDIO','--enable_raw_key_encryption','--keys',`label=VIDEO:key_id=${video.kid}:key=${video.key},label=AUDIO:key_id=${audio.kid}:key=${audio.key}`,'--protection_scheme','cbcs','--protection_systems','PlayReady','--hls_playlist_type','VOD','--segment_duration','1','--hls_master_playlist_output','master.m3u8'])
    const manifest=readFileSync(join(root,'master.m3u8'),'utf8')
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`
    const cfg={outDir:join(root,'output'),tmpDir:join(root,'work'),threads:2,releaseGroup:'TEST'} as FileConfig
    const cli={invoke:async(p:string,a:string,input:Record<string,unknown>)=>{expect(p).toBe('appletvplus');expect(a).toBe('resolve');expect(input.download).toBe(true);return {manifest,media:[{url:`${base}/master.m3u8`,format:'hls',height:90,drm:{system:'playready',clear:false,contentKeys:[video,audio]}}]}}} as unknown as GwClient
    const task: DlTask={provider:'appletvplus',title:'Apple CBCS fixture',series:'Apple CBCS fixture',vid:'umc.cmc.fixture',quality:'auto',season:1,episode:1,height:90,codec:'H264',group:'TEST',tmdbId:0,nameDots:'',year:2026,plot:''}
    hub.enqueue(cfg,cli,1,task)
    const deadline=Date.now()+45000
    while(!events.some(e=>e.id===1&&e.done)){if(Date.now()>deadline)throw new Error('CBCS fixture timed out');await Bun.sleep(20)}
    const finished=events.find(e=>e.id===1&&e.done)!
    if(finished.err){const logs=readdirSync(root,{recursive:true}).filter(p=>String(p).endsWith('.download-error.log')).map(p=>readFileSync(join(root,String(p)),'utf8')).join('\n');throw new Error(`${finished.err}\n${logs}`)}
    expect(finished.status).toBe('完成')
    expect(readFileSync(finished.log).subarray(0,4).toString('hex')).toBe('1a45dfa3')
    run(ffmpeg,['-nostdin','-v','error','-xerror','-i',finished.log,'-map','0:v','-map','0:a','-f','null','-'])
    expect(requested.some(u=>u.includes('video-'))).toBe(true)
    expect(requested.some(u=>u.includes('audio-'))).toBe(true)
    const logs=JSON.stringify(events);expect(logs).not.toContain(video.key);expect(logs).not.toContain(audio.key)
  } finally {await hub.cancelAll();server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true})}
},100000)
