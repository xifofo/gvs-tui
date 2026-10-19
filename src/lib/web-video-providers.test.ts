import { expect, test } from 'bun:test'
import { bilibiliOptions, mgtvOptions, probeWebVideo, selectedBilibiliMedia, webVideoDetail, webVideoLink, webTracks } from './web-video-providers'
import { ProviderSessions } from './provider-session'
import { needsTunnel } from './tunnel-policy'
import { PROVIDER_IDS } from './providers'
import { parseEpisodes } from './episodes'

const media = [
  {type:'video',quality:'80',codecFamily:'hevc',codec:'hev1.1.6.L120',qualityLabel:'1080P 高清',width:1920,height:1080,fps:30,dynamicRange:'SDR',url:'https://cdn.invalid/v',separate:true},
  {type:'video',quality:'80',codecFamily:'avc',codec:'avc1.640028',qualityLabel:'1080P 高清',url:'https://cdn.invalid/v2',separate:true},
  {type:'audio',quality:'30280',codecFamily:'aac',codec:'mp4a.40.2',qualityLabel:'高品质音质',group:'dash',url:'https://cdn.invalid/a'},
  {type:'audio',quality:'30251',codecFamily:'flac',codec:'fLaC',qualityLabel:'Hi-Res 无损',group:'flac',url:'https://cdn.invalid/f'},
]

test('Migu TV series with a partial catalog is not rejected by the mobile completeness rule', async () => {
  const d = await webVideoDetail(async (provider, action, input) => {
    expect([provider, action]).toEqual(['migu', 'detail'])
    expect(input).toEqual({ id: 'tv-series:968082109', pageSize: 100, terminal: 'tv', devicePreset: 'max' })
    return { id: input.id, sourceTerminal: 'tv', episodesComplete: false,
      episodes: [{ id: 'tv:968181178', vid: 'tv:968181178', title: '第1集' }] }
  }, 'migu', 'tv-series:968082109')
  expect(d.episodesComplete).toBe(false)
  expect(d.desc).toContain('TV 目录未完整')
  expect(parseEpisodes(d)[0]!.vid).toBe('tv:968181178')
})

test('Migu TV episode can retain its explicitly partial single-episode catalog', async () => {
  const d = await webVideoDetail(async (_provider, _action, input) => {
    expect(input.terminal).toBe('tv')
    return { id: input.id, episodesComplete: false, episodesScope: 'requested-episode', episodes: [{ id: input.id, vid: input.id }] }
  }, 'migu', 'tv:968181178')
  expect(d.episodesScope).toBe('requested-episode')
  expect(d.episodesComplete).toBe(false)
  expect(d.desc).toContain('仅返回当前单集目录')
})

test('Migu App still rejects incomplete catalogs and sends mobile terminal', async () => {
  await expect(webVideoDetail(async (_provider, _action, input) => {
    expect(input.terminal).toBe('mobile')
    return { id: input.id, episodesComplete: false, episodes: [{ vid: '968181177' }] }
  }, 'migu', '968082110')).rejects.toThrow('咪咕分集列表不完整')
})
test('platform scope includes both providers and keys restricted to either still start a tunnel',()=>{
  for(const provider of ['mgtv','bilibili']) {expect(PROVIDER_IDS as readonly string[]).toContain(provider);expect(needsTunnel(p=>p===provider)).toBe(true)}
})
test('links are strict and retain BV page/episode identity',()=>{
  expect(webVideoLink('BV17x411w7KC?p=2')).toEqual({provider:'bilibili',url:'BV17x411w7KC?p=2'})
  expect(webVideoLink('https://b23.tv/test')?.provider).toBe('bilibili')
  expect(webVideoLink('https://www.mgtv.com/b/1/2.html')?.provider).toBe('mgtv')
  for(const s of ['https://mgtv.com.evil.test/b/1/2.html','https://user@www.bilibili.com/video/BV17x411w7KC','http://127.0.0.1/x']) expect(webVideoLink(s)).toBeUndefined()
})
test('Bilibili choices retain qn plus codec, choose only actual video tracks and keep audio separate',()=>{
  const opts=bilibiliOptions({qualityOptions:[{id:'120',available:false}],media})
  expect(opts.qualities.map(q=>q.id)).toEqual(['80|hevc','80|avc'])
  expect(opts.audios).toHaveLength(2)
  expect(opts.audios.find(a=>a.selected)?.codec).toBe('fLaC')
  const plan=selectedBilibiliMedia({media},'80|hevc',[opts.audios[0]!.id])
  expect(plan.videos[0]!.url).toBe('https://cdn.invalid/v')
  expect(plan.audios[0]!.url).toBe('https://cdn.invalid/a')
  expect(()=>selectedBilibiliMedia({media},'120|hevc',[])).toThrow('画质')
  expect(()=>selectedBilibiliMedia({media},'80|hevc',['missing'])).toThrow('音轨')
  expect(()=>selectedBilibiliMedia({media,isPreview:true},'80|hevc',[opts.audios[0]!.id])).toThrow('试看')
  const next=media.map(m=>({...m,url:m.url+'-episode-2'}))
  expect(selectedBilibiliMedia({media:next},'80|hevc',[opts.audios[0]!.id]).audios[0]!.url).toEndWith('episode-2')
})
test('progressive fragments form one option and incomplete sequences fail',()=>{
  const fragments=[1,2].map(n=>({type:'video',quality:'64',codecFamily:'avc',url:'https://cdn.invalid/'+n,separate:false,segment:n,segmentCount:2}))
  expect(bilibiliOptions({media:fragments}).qualities).toHaveLength(1)
  expect(selectedBilibiliMedia({media:fragments.reverse()},'64|avc',[]).videos.map(t=>t.segment)).toEqual([1,2])
  expect(()=>selectedBilibiliMedia({media:fragments.slice(0,1)},'64|avc',[])).toThrow('不完整')
  expect(()=>webTracks({media:[{...media[0],drm:true}]})).toThrow('受保护')
})
test('MGTV only exposes selectable entries without inventing actual HDR or dimensions',()=>{
  const opts=mgtvOptions({qualities:[{quality:'11',name:'4K HDR',catalogHDR:'hdr_vivid',nominalHeight:2160,selectable:true,frameRate:50},{quality:'9',selectable:false}]})
  expect(opts.qualities).toHaveLength(1);expect(opts.qualities[0]!.hdr).toBe('unknown');expect(opts.qualities[0]!.height).toBe(0);expect(opts.qualities[0]!.tier).toBe(2160)
})
test('MGTV estimates each rendition from its own catalog kbps and the selected episode duration',()=>{
  // 玉簟秋 E01: 45:22; the qualities API supplies kbps but no file sizes.
  const opts=mgtvOptions({qualities:[
    {quality:'10',selectable:true,bitrateKbps:9746,nominalHeight:2160,frameRate:50},
    {quality:'9',selectable:true,bitrateKbps:'8770',nominalHeight:2160,frameRate:25},
    {quality:'4',selectable:true,bitrateKbps:1985,nominalHeight:1080},
    {quality:'1',selectable:false,bitrateKbps:428},
  ]},2722)
  expect(opts.qualities.map(q=>q.size)).toEqual([9746,8770,1985].map(kbps=>Math.round(kbps*1000*2722/8)))
  expect(opts.qualities.every(q=>q.duration===2722&&q.height===0&&q.hdr==='unknown')).toBe(true)
  const second=mgtvOptions({qualities:[{quality:'10',selectable:true,bitrateKbps:9746}]},2870)
  expect(second.qualities[0]!.size).toBe(Math.round(9746*1000*2870/8))
})
test('MGTV keeps supplied bytes and uses duration metadata only when it is available',()=>{
  const opts=mgtvOptions({duration:200,qualities:[
    {quality:'10',selectable:true,size:123456,estimatedSize:234567,bitrateKbps:1000},
    {quality:'9',selectable:true,estimatedSize:'234567',bitrateKbps:1000},
    {quality:'4',selectable:true,duration:120,bitrateKbps:1000},
    {quality:'3',selectable:true,bitrateKbps:1000},
  ]},100)
  expect(opts.qualities.map(q=>q.size)).toEqual([123456,234567,15000000,12500000])
  expect(mgtvOptions({duration:200,qualities:[{quality:'1',selectable:true,bitrateKbps:1000}]}).qualities[0]!.size).toBe(25000000)
})
test('MGTV leaves size unknown without valid bitrate and duration instead of guessing from resolution',()=>{
  const quality={quality:'10',selectable:true,name:'4K',nominalHeight:2160}
  for(const rate of [undefined,0,-1,true,'invalid',Infinity]) {
    expect(mgtvOptions({qualities:[{...quality,bitrateKbps:rate}]},2722).qualities[0]!.size).toBe(0)
  }
  for(const duration of [undefined,0,-1,NaN,Infinity]) {
    expect(mgtvOptions({qualities:[{...quality,bitrateKbps:9746}]},duration).qualities[0]!.size).toBe(0)
  }
  expect(mgtvOptions({duration:true,qualities:[{...quality,bitrateKbps:9746}]}).qualities[0]!.size).toBe(0)
  expect(mgtvOptions({qualities:[{...quality,bitrateKbps:1e300}]},2722).qualities[0]!.size).toBe(0)
})
test('MGTV quality probing uses the supplied episode duration with a single catalog request',async()=>{
  const calls:unknown[]=[]
  const opts=await probeWebVideo(async(p,a,input)=>{
    calls.push({p,a,input})
    return {qualities:[{quality:'10',selectable:true,bitrateKbps:9746}]}
  },'mgtv','24697722',2722)
  expect(opts.qualities[0]!.size).toBe(Math.round(9746*1000*2722/8))
  expect(calls).toEqual([{p:'mgtv',a:'qualities',input:{vid:'24697722',support4k:true,supportHDR10:true,qualityPolicy:'best'}}])
})
test('MGTV reads all pages without losing non-intact entries and focuses a direct video',async()=>{
  const calls:Record<string,unknown>[]=[]
  const d=await webVideoDetail(async(_p,_a,input)=>{
    calls.push(input)
    return {id:'clip:1',vid:'2',episodes:input.cursor ? [{vid:'3',number:'2',isIntact:false}] : [{vid:'2',number:'1',isIntact:true}],hasMore:!input.cursor,nextCursor:input.cursor?'':'2'}
  },'mgtv','https://www.mgtv.com/b/1/2.html',async()=>new Response('',{status:503}))
  expect(calls).toHaveLength(2);expect(d.focusVid).toBe('2');expect(d.episode_groups).toEqual(['正片','其他视频'])
})
test('Bilibili preserves short explicit pages and the gateway-resolved short-link page',async()=>{
  const d=await webVideoDetail(async()=>({id:'BV17x411w7KC',focusVid:'BV17x411w7KC?p=2',episodes:[{id:'BV17x411w7KC?p=1',title:'clip 预告',number:1,duration:20},{id:'BV17x411w7KC?p=2',title:'第二P',number:2,duration:30}]}),'bilibili','https://b23.tv/short')
  expect(parseEpisodes(d)).toHaveLength(2)
  expect(d.focusVid).toBe('BV17x411w7KC?p=2')
})
test('MGTV QR polling retains challenge, obeys interval and drops it on gateway switch',async()=>{
  let now=1000;const inputs:Record<string,unknown>[]=[]
  const sessions=new ProviderSessions(async(_p,_a,input)=>{inputs.push(input);return input.op==='start'?{state:'pending',sessionId:'flow',qrUrl:'https://oauth.mgtv.com/2.0/multicode_login?uid=abc',qrDataUrl:'data:image/png;base64,YQ==',interval:3,expiresIn:300}:{state:'authenticated',loggedIn:true}},()=>now)
  await sessions.command({provider:'mgtv',op:'start'});await sessions.command({provider:'mgtv',op:'poll'})
  expect(inputs).toHaveLength(1);now+=3000
  expect((await sessions.command({provider:'mgtv',op:'poll'})).authenticated).toBe(true)
  expect(inputs[1]?.sessionId).toBe('flow')
  sessions.setScope('other')
  await expect(sessions.command({provider:'mgtv',op:'poll'})).rejects.toThrow('过期')
})
test('Bilibili credential is only sent to import and never returned in the view',async()=>{
  const calls:Record<string,unknown>[]=[]
  const s=new ProviderSessions(async(_p,_a,i)=>{calls.push(i);return {loggedIn:true,state:'authenticated',cookie:'PRIVATE'}})
  const view=await s.command({provider:'bilibili',op:'import',cookie:'SESSDATA=PRIVATE'})
  await s.command({provider:'bilibili',op:'status'})
  expect(calls).toEqual([{op:'import',cookie:'SESSDATA=PRIVATE'},{op:'status'}]);expect(JSON.stringify(view)).not.toContain('PRIVATE')
})
test('Bilibili QR login maps gateway qr/poll states and paces polling',async()=>{
  let now=1000;const calls:Record<string,unknown>[]=[]
  const replies=[{state:'qr_pending',qrUrl:'https://account.bilibili.com/h5/account-h5/auth/scan-web?qrcode_key=K',expiresIn:180},{state:'qr_scanned'},{loggedIn:true,state:'authenticated',name:'测试'}]
  const s=new ProviderSessions(async(p,a,i)=>{expect([p,a]).toEqual(['bilibili','login']);calls.push(i);return replies.shift()!},()=>now)
  const start=await s.command({provider:'bilibili',op:'start'})
  expect(start.state).toBe('pending');expect(start.url).toContain('bilibili.com')
  expect((await s.command({provider:'bilibili',op:'poll'})).state).toBe('pending')
  expect(calls.length).toBe(1)
  now+=2000;const scanned=await s.command({provider:'bilibili',op:'poll'})
  expect(scanned.summary).toContain('确认')
  now+=2000;expect((await s.command({provider:'bilibili',op:'poll'})).authenticated).toBe(true)
  expect(calls).toEqual([{op:'qr'},{op:'poll'},{op:'poll'}])
  await expect(s.command({provider:'bilibili',op:'poll'})).rejects.toThrow('过期')
})
test('Bilibili QR rejects untrusted QR hosts and surfaces expiry',async()=>{
  const bad=new ProviderSessions(async()=>({state:'qr_pending',qrUrl:'https://evil.example/?qrcode_key=K'}))
  await expect(bad.command({provider:'bilibili',op:'start'})).rejects.toThrow('无效')
  const replies=[{state:'qr_pending',qrUrl:'https://account.bilibili.com/x',expiresIn:180},{state:'qr_expired',loggedIn:false}]
  let now=0;const s=new ProviderSessions(async()=>replies.shift()!,()=>now)
  await s.command({provider:'bilibili',op:'start'});now+=2000
  const v=await s.command({provider:'bilibili',op:'poll'})
  expect(v.state).toBe('expired');expect(v.summary).toContain('过期')
})
