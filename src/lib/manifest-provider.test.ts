import { describe, expect, test } from 'bun:test'
import { manifestInput, manifestSources, probeManifest, providerLink, requireClearDownload } from './manifest-provider.ts'
import { manifestDetail, normalizeManifestDetail } from './manifest-detail.ts'
import { parseEpisodes } from './episodes.ts'
import { PROVIDER_IDS, supportsBrowse, supportsSearch } from './providers.ts'
import { needsTunnel } from './tunnel-policy.ts'
import type { GwClient } from './client.ts'
import type { FileConfig } from './config.ts'

describe('manifest provider client contracts', () => {
  const media = { url:'https://cdn.example/video.mpd', type:'video', format:'dash', height:2160, headers:{Referer:'https://example.test/',Authorization:'test-session'}, drm:{clear:true} }
  test('both clients share providers, with Hami tunnel but no fabricated search', () => {
    expect(PROVIDER_IDS).toContain('mewatch'); expect(PROVIDER_IDS).toContain('hamivideo')
    expect(needsTunnel(p => p === 'hamivideo')).toBe(true)
    expect(supportsBrowse('hamivideo')).toBe(false); expect(supportsSearch('hamivideo')).toBe(false)
  })
  test('normalized media keeps paired CDN URL and headers', () => {
    const [m] = manifestSources({media:[media]})
    expect(m!.url).toBe(media.url); expect(m!.headers.Authorization).toBe('test-session'); expect(m!.clear).toBe(true)
    expect(() => requireClearDownload(m!)).not.toThrow()
  })
  test('raw and per-media metadata retain DRM boundaries', () => {
    const [m] = manifestSources({media:[{url:media.url,meta:{format:'dash',drm:{system:'widevine',clear:false}}}]})
    expect(m!.drm).toBe('widevine'); expect(() => requireClearDownload(m!)).toThrow('DRM_CLIENT_UNAVAILABLE')
    expect(manifestSources({raw:{media:[media]}})).toHaveLength(1)
  })
  test('unknown DRM and live streams fail before starting download', () => {
    const [unknown] = manifestSources({media:[{...media,drm:{system:'none',encryption:'uninspected'}}]})
    expect(() => requireClearDownload(unknown!)).toThrow()
    const [live] = manifestSources({media:[media],raw:{isLive:true}})
    expect(() => requireClearDownload(live!)).toThrow('直播')
  })
  test('rejects invalid URLs and header line injection', () => {
    expect(manifestSources({media:[{...media,url:'file:///secret'}]})).toHaveLength(0)
    const [m] = manifestSources({media:[{...media,headers:{Good:'value',Bad:'x'+String.fromCharCode(10)+'X: y'}}]})
    expect(m!.headers).toEqual({Good:'value'})
  })
  test('Web and TV route stay separate and qualities do not become dash/hls', async () => {
    expect(manifestInput('hamivideo',{hamiClient:'web'},'OTT_VOD_1')).toEqual({id:'OTT_VOD_1',client:'web',quality:'auto'})
    const calls: unknown[] = []; const cli = {invoke:async (...args:unknown[]) => {calls.push(args);return {media:[media]}}} as unknown as GwClient
    const tv = await probeManifest(cli,{hamiClient:'tv'} as FileConfig,'hamivideo','OTT_VOD_1')
    expect(tv.qualities[0]!.stream).toBe('2160')
    const web = await probeManifest(cli,{hamiClient:'web'} as FileConfig,'hamivideo','OTT_VOD_1')
    expect(web.qualities[0]!.stream).toBe('auto'); expect(calls).toHaveLength(2)
  })
  test('recognizes exact source domains only', () => {
    expect(providerLink('https://hamivideo.hinet.net/product/1')).toEqual({provider:'hamivideo',url:'https://hamivideo.hinet.net/product/1'})
    expect(providerLink('https://www.mewatch.sg/show/1')?.provider).toBe('mewatch')
    expect(providerLink('https://hamivideo.hinet.net.evil.test/product/1')).toBeUndefined()
    expect(providerLink('https://secret@hamivideo.hinet.net/product/1')).toBeUndefined()
  })
  test('single mewatch movie yields playable item ID, not parent show ID', () => {
    const d = normalizeManifestDetail({id:'movie1',title:'Film',raw:{type:'movie'}})
    expect(parseEpisodes(d)[0]!.vid).toBe('movie1'); expect(d.category).toBe('电影')
  })
  test('collects paginated episodes, deduplicates and preserves season/episode identity', async () => {
    let calls = 0
    const d = await manifestDetail(async (_p,_a,input) => {calls++;return input.cursor ? {episodes:[{id:'b',seasonNumber:2,episodeNumber:4}],hasMore:false} : {title:'Show',episodes:[{id:'a',seasonNumber:1,episodeNumber:3}],hasMore:true,nextCursor:'2'}},'mewatch','show1')
    expect(calls).toBe(2); expect(parseEpisodes(d).map(e => [e.vid,e.season,e.number])).toEqual([['a',1,3],['b',2,4]])
  })
  test('repeating cursor cannot create an infinite request loop', async () => {
    let calls=0; const d = await manifestDetail(async () => {calls++;return {episodes:[{id:'a'}],hasMore:true,nextCursor:'same'}},'mewatch','show1')
    expect(calls).toBe(2); expect(d.hasMore).toBe(true); expect(d.episodes).toHaveLength(1)
  })
})
