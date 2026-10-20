import { expect, test } from 'bun:test'
import { manifestInput, probeManifest, providerLink, resolveManifestDownload } from './manifest-provider'
import { manifestDetail } from './manifest-detail'
import { ProviderSessions } from './provider-session'
import { usesMeasuredNaming } from './completed-naming'
import type { GwClient } from './client'
import type { FileConfig } from './config'

const id = 'umc.cmc.episode'
const keys = [{kid:'1'.repeat(32),key:'2'.repeat(32)}]
const response = {manifest:'#EXTM3U\n',media:[{url:'https://vod-ak-svod.tv.apple.com/master.m3u8',format:'hls',height:1080,drm:{system:'playready',clear:false,contentKeys:keys}}]}

test('Apple TV recognizes exact URLs/IDs and retains the selected codec/HDR rendition', async () => {
  expect(providerLink(id)).toEqual({provider:'appletvplus',url:id})
  expect(providerLink('https://tv.apple.com/jp/show/test/umc.cmc.show')).toMatchObject({provider:'appletvplus'})
  expect(providerLink('https://tv.apple.com.evil.invalid/jp/show/a/umc.cmc.show')).toBeUndefined()
  expect(manifestInput('appletvplus',{},id,'1080|H265|PQ|24')).toEqual({id,quality:'1080|H265|PQ|24'})
  const cli={invoke:async(p:string,a:string,input:Record<string,unknown>)=>{expect(p).toBe('appletvplus');expect(a).toBe('resolve');expect(input).toEqual({id,quality:'1080|H265|PQ|24',download:true});return response}} as unknown as GwClient
  const sources=await resolveManifestDownload(cli,{},'appletvplus',id,'1080|H265|PQ|24')
  expect(sources[0]?.format).toBe('hls');expect(sources[0]?.contentKeys).toEqual([`${'1'.repeat(32)}:${'2'.repeat(32)}`])
  expect(usesMeasuredNaming({provider:'appletvplus'})).toBe(true)
})

test('Apple TV never starts an encrypted download without PlayReady/Widevine keys', async () => {
  for(const drm of [{system:'playready',clear:false},{system:'widevine',clear:false},{system:'fairplay',clear:false,contentKeys:keys}]){
    const cli={invoke:async()=>({...response,media:[{...response.media[0],drm}]})} as unknown as GwClient
    await expect(resolveManifestDownload(cli,{},'appletvplus',id)).rejects.toThrow('DRM_CLIENT_UNAVAILABLE')
  }
})

test('Apple TV accepts content keys from the user Widevine (.wvd) route', async () => {
  const cli={invoke:async()=>({...response,media:[{...response.media[0],drm:{system:'widevine',clear:false,contentKeys:keys}}]})} as unknown as GwClient
  expect((await resolveManifestDownload(cli,{},'appletvplus',id))[0]?.contentKeys).toEqual([`${'1'.repeat(32)}:${'2'.repeat(32)}`])
})

test('Apple TV probes without decrypt requests and preserves all official quality IDs', async () => {
  const cli={invoke:async(_p:string,a:string,input:Record<string,unknown>)=>{expect(a).toBe('probe');expect(input.download).toBeUndefined();return {qualities:[{id:'2160|DV|PQ|24',height:2160,width:3840,codec:'DV',hdr:'PQ',fps:'24',label:'2160p DV PQ'},{id:'1080|H264|SDR|24',height:1080,width:1920,codec:'H264',hdr:'SDR',fps:'24',label:'1080p H264 SDR'}]}}} as unknown as GwClient
  const out=await probeManifest(cli,{} as FileConfig,'appletvplus',id)
  expect(out.qualities.map(q=>q.id)).toEqual(['2160|DV|PQ|24','1080|H264|SDR|24'])
  expect(out.qualities[0]).toMatchObject({height:2160,codec:'DV',drm:'playready',fps:24,size:0})
})

test('Apple TV shows an identified size instead of leaving every rendition unknown', async () => {
  const cli={invoke:async()=>({qualities:[
    {id:'2160|DV|PQ|24',height:2160,width:3840,codec:'DV',label:'2160p DV PQ',size:'4000000000'},
    {id:'1080|H265|PQ|24',height:1080,width:1920,codec:'H265',label:'1080p',bitrate:8_000_000,duration:3600},
    {id:'720|H264|SDR|24',height:720,width:1280,codec:'H264',label:'720p',averageBitrate:'2000000'},
    {id:'480|H264|SDR|24',height:480,width:854,codec:'H264',label:'480p',bitrateKbps:1000},
  ]})} as unknown as GwClient
  const out=await probeManifest(cli,{} as FileConfig,'appletvplus',id,1800)
  expect(out.qualities.map(q=>q.size)).toEqual([
    4_000_000_000,
    Math.round(8_000_000 * 3600 / 8),
    Math.round(2_000_000 * 1800 / 8),
    Math.round(1000 * 1000 * 1800 / 8),
  ])
  expect(out.qualities[2]?.title).toContain('估算')
  for (const rate of [undefined, 0, -1, 'invalid', Infinity]) {
    const missing=await probeManifest({invoke:async()=>({qualities:[{id:'2160|H265|SDR|24',height:2160,width:3840,codec:'H265',label:'4K',bitrate:rate}]})} as unknown as GwClient,{} as FileConfig,'appletvplus',id,1800)
    expect(missing.qualities[0]?.size).toBe(0)
  }
})

test('Apple TV preserves complete season/episode identity from gateway detail', async () => {
  const out=await manifestDetail(async(_p,a)=>{expect(a).toBe('detail');return {id:'umc.cmc.show',type:'series',title:'作品',episodesComplete:true,episodes:[{id,vid:id,season:2,number:3,title:'第二季第三集'}]}},'appletvplus','umc.cmc.show')
  expect((out.episodes as Record<string,unknown>[])[0]).toMatchObject({id,season:2,number:3})
})

test('Apple TV imports transient CK, distinguishes verification and restricts official login URLs', async () => {
  const calls:Array<Record<string,unknown>>=[]
  const sessions=new ProviderSessions(async(_p,_a,input)=>{calls.push(input);return input.op==='import'?{state:'imported',authenticated:false,summary:'已导入，待验证'}:input.op==='web'?{state:'awaiting_cookie',url:'https://tv.apple.com/jp'}:{state:'authenticated',authenticated:true}})
  const imported=await sessions.command({provider:'appletvplus',op:'import',cookie:'itua=JP; media-user-token=fixture'})
  expect(imported.authenticated).toBe(false)
  const verified=await sessions.command({provider:'appletvplus',op:'verify',id});expect(verified.authenticated).toBe(true);expect(calls.at(-1)).toEqual({op:'verify',id})
  expect((await sessions.command({provider:'appletvplus',op:'web'})).url).toBe('https://tv.apple.com/jp')
  await expect(sessions.command({provider:'appletvplus',op:'password',username:'x',password:'x'})).rejects.toThrow('不支持')
  const bad=new ProviderSessions(async()=>({state:'awaiting_cookie',url:'https://evil.invalid/'}))
  await expect(bad.command({provider:'appletvplus',op:'web'})).rejects.toThrow('非官方')
})
