import { beforeAll, afterAll, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { downloadWebVideo } from '../src/lib/web-video-download'
import { lookBundledFFmpeg, lookMkvmerge } from '../src/lib/tools'
import type { FileConfig } from '../src/lib/config'
import type { DlTask } from '../src/lib/jobs'
import type { GwClient } from '../src/lib/client'

// Entire media flow uses generated 2-second fixtures served by this process on loopback.
// No account, upstream CDN or external network is used.
let dir: string, base: string, server: Server
const requests: string[] = []
const ffmpeg = lookBundledFFmpeg()
function generate(args: string[]) {
  const out = spawnSync(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-y',...args],{windowsHide:true,encoding:'utf8'})
  if (out.status !== 0) throw new Error(out.stderr)
}
beforeAll(async()=>{
  mkdirSync('.build',{recursive:true});dir=mkdtempSync(resolve('.build/web-video-media-'))
  generate(['-f','lavfi','-i','testsrc2=size=320x180:rate=25','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-an',join(dir,'video.mp4')])
  for(const [name,freq,channels] of [['audio1',440,1],['audio2',880,2]] as const)
    generate(['-f','lavfi','-i',`sine=frequency=${freq}:sample_rate=48000`,'-t','2','-ac',String(channels),'-c:a','aac',join(dir,name+'.mp4')])
  generate(['-i',join(dir,'video.mp4'),'-i',join(dir,'audio1.mp4'),'-map','0:v','-map','1:a','-c','copy',join(dir,'muxed.mp4')])
  generate(['-i',join(dir,'muxed.mp4'),'-c','copy','-hls_time','1','-hls_list_size','0','-hls_segment_filename',join(dir,'part%d.ts'),join(dir,'index.m3u8')])
  const allowed=new Set(readdirSync(dir))
  server=createServer((req,res)=>{
    const name=new URL(req.url||'/',base).pathname.slice(1)
    requests.push(name)
    if(!allowed.has(name)){res.writeHead(404);res.end();return}
    const raw=readFileSync(join(dir,name))
    res.setHeader('Content-Type',name.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'application/octet-stream')
    res.setHeader('Accept-Ranges','bytes')
    const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '')
    if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),raw.length-1):raw.length-1;res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${raw.length}`,'Content-Length':end-start+1});res.end(req.method==='HEAD'?undefined:raw.subarray(start,end+1))}
    else {res.setHeader('Content-Length',raw.length);res.end(req.method==='HEAD'?undefined:raw)}
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  base=`http://127.0.0.1:${(server.address() as {port:number}).port}`
},30000)
afterAll(async()=>{await new Promise<void>(resolve=>server?.close(()=>resolve()))})
const cfg={threads:1} as FileConfig
function task(provider:string,quality:string):DlTask {return {provider,vid:provider==='bilibili'?'BV17x411w7KC?p=2':'3660147',quality,duration:2,height:0,title:'合成测试',series:'合成测试',season:1,episode:2,group:'TEST',codec:'',tmdbId:0,nameDots:'',year:0,plot:''}}
function inspect(output:string){const p=spawnSync(lookMkvmerge(),['-J',output],{windowsHide:true,encoding:'utf8'});if(p.status!==0)throw new Error(p.stderr);return JSON.parse(p.stdout) as {tracks:Array<{type:string;properties:{default_track:boolean;audio_channels?:number}}>}}

test('Bilibili downloads freshly resolved page-specific tracks and muxes the chosen default audio',async()=>{
  const t=task('bilibili','80|avc');t.audioTracks=[{id:'30280|aac|mp4a.40.2|dash',label:'AAC',lang:'原声',isDefault:false},{id:'30232|aac|mp4a.40.2|dash',label:'AAC',lang:'原声',isDefault:true}]
  const calls:unknown[]=[]
  const cli={invoke:async(p:string,a:string,input:Record<string,unknown>)=>{calls.push([p,a,input]);return {id:t.vid,media:[{type:'video',url:base+'/video.mp4',quality:'80',codecFamily:'avc',codec:'avc1.640028',separate:true},...[['30280','audio1'],['30232','audio2']].map(([q,name])=>({type:'audio',url:base+'/'+name+'.mp4',quality:q,codecFamily:'aac',codec:'mp4a.40.2',group:'dash'}))]}}} as unknown as Pick<GwClient,'invoke'>
  const work=join(dir,'dash');mkdirSync(work)
  const output=join(dir,'dash-output.mkv')
  await downloadWebVideo(cli,cfg,t,output,work,()=>{})
  expect(calls).toEqual([['bilibili','resolve',{id:'BV17x411w7KC?p=2',quality:'80',codec:'avc'}]])
  const tracks=inspect(output).tracks
  expect(tracks.filter(t=>t.type==='video')).toHaveLength(1)
  const audios=tracks.filter(t=>t.type==='audio');expect(audios).toHaveLength(2)
  expect(audios.find(t=>t.properties.default_track)?.properties.audio_channels).toBe(2)
},60000)

test('Bilibili progressive fragments concatenate in order into one complete movie',async()=>{
  const t=task('bilibili','64|avc');t.duration=4
  const cli={invoke:async()=>({id:t.vid,media:[1,2].map(n=>({type:'video',url:base+'/muxed.mp4',quality:'64',codecFamily:'avc',separate:false,segment:n,segmentCount:2}))})} as unknown as Pick<GwClient,'invoke'>
  const work=join(dir,'progressive');mkdirSync(work)
  const output=join(dir,'progressive-output.mkv')
  await downloadWebVideo(cli,cfg,t,output,work,()=>{})
  expect(inspect(output).tracks.map(t=>t.type)).toEqual(['video','audio'])
},60000)

test('MGTV downloads and remuxes a clear HLS fixture through the shared local media pipeline',async()=>{
  const t=task('mgtv','9')
  const cli={invoke:async(p:string,a:string,input:Record<string,unknown>)=>{
    expect(p).toBe('mgtv');expect(a).toBe('play');expect(input.vid).toBe('3660147');expect(input.quality).toBe('9');expect(input.support4k).toBe(true)
    return {vid:t.vid,actualQuality:'9',preview:false,media:[{type:'video',url:base+'/index.m3u8',quality:'9',format:'hls',drm:false}]}
  }} as unknown as Pick<GwClient,'invoke'>
  const work=join(dir,'mgtv');mkdirSync(work)
  const output=join(dir,'mgtv-output.mkv')
  await downloadWebVideo(cli,cfg,t,output,work,()=>{})
  expect(inspect(output).tracks.map(t=>t.type)).toEqual(['video','audio'])
  expect(requests.some(p=>p.endsWith('.ts'))).toBe(true)
},60000)

test('substituted or preview MGTV streams are rejected before any media is requested',async()=>{
  const before=requests.length
  for(const response of [{actualQuality:'4',media:[]},{actualQuality:'9',preview:true,media:[]}]) {
    const cli={invoke:async()=>({vid:'3660147',...response})} as unknown as Pick<GwClient,'invoke'>
    await expect(downloadWebVideo(cli,cfg,task('mgtv','9'),join(dir,'reject.mkv'),dir,()=>{})).rejects.toThrow()
  }
  expect(requests.length).toBe(before)
})

test('Migu uses mobile protocol and downloads HLS directly with embedded audio',async()=>{
  const t=task('migu','tv:8')
  const cli={invoke:async(p:string,a:string,input:Record<string,unknown>)=>{
    expect(p).toBe('migu');expect(a).toBe('resolve');expect(input.terminal).toBe('unified');expect(input.quality).toBe('tv:8')
    return {id:t.vid,actualQuality:'tv:8',trial:false,media:[{type:'video',url:base+'/index.m3u8',quality:'tv:8',format:'hls',drm:false,duration:2}]}
  }} as unknown as Pick<GwClient,'invoke'>
  const work=join(dir,'migu');mkdirSync(work)
  const output=join(dir,'migu-output.mkv')
  await downloadWebVideo(cli,cfg,t,output,work,()=>{})
  expect(inspect(output).tracks.map(t=>t.type)).toEqual(['video','audio'])
},60000)

test('Migu refuses previews, downgrades and protected streams before CDN access',async()=>{
  const before=requests.length
  for(const response of [{actualQuality:'7'},{actualQuality:'5',trial:true},{actualQuality:'5',media:[{type:'video',url:base+'/index.m3u8',drm:true}]}]) {
    const cli={invoke:async()=>({id:'3660147',...response})} as unknown as Pick<GwClient,'invoke'>
    await expect(downloadWebVideo(cli,cfg,task('migu','5'),join(dir,'migu-reject.mkv'),dir,()=>{})).rejects.toThrow()
  }
  expect(requests.length).toBe(before)
})

test('wrong episode identities fail before downloading media',async()=>{
  const before=requests.length
  for(const provider of ['mgtv','bilibili','migu']) {
    const cli={invoke:async()=>({id:'WRONG',vid:'WRONG',actualQuality:'9',media:[]})} as unknown as Pick<GwClient,'invoke'>
    await expect(downloadWebVideo(cli,cfg,task(provider,provider==='mgtv'?'9':'80|avc'),join(dir,'wrong.mkv'),dir,()=>{})).rejects.toThrow('分集')
  }
  expect(requests.length).toBe(before)
})
