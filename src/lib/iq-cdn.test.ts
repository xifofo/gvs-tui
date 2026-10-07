import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { iqCDNWindow, iqCDNSlowGuard, selectIQCDN } from './iq-cdn.ts'

const source = 'https://data.video.iq.com/file.bbts?start=100&end=65636&contentlength=65536&sd=4000&qd_sc=original'
const fast = 'https://fast.inter.iqiyi.com/file.bbts?key=fresh-secret&qd_sc=cdn-signature'
const slow = 'https://slow.inter.iqiyi.com/file.bbts?key=other-secret'
const playlist = `#EXTM3U\n#EXTINF:4,\n${source}\n#EXT-X-ENDLIST\n`
const candidates = [{ path: '/file.bbts', urls: [slow,fast] }]

test('CDN replacement retains its fresh signature, exact file path and requested byte window', () => {
  const u = new URL(iqCDNWindow(fast,source)!)
  expect(u.searchParams.get('key')).toBe('fresh-secret')
  expect(u.searchParams.get('qd_sc')).toBe('cdn-signature')
  expect(u.searchParams.get('start')).toBe('100')
  expect(u.searchParams.get('end')).toBe('65636')
  expect(iqCDNWindow(fast.replace('file.bbts','other.bbts'),source)).toBeUndefined()
  expect(iqCDNWindow(fast.replace('fast.inter.iqiyi.com','iqiyi.com.evil.invalid'),source)).toBeUndefined()
})

test('measure once, save only the hostname, and reuse it with freshly signed URLs on the next job', async () => {
  const dir = mkdtempSync(join(tmpdir(),'iq-cdn-')), path = join(dir,'preference.json')
  const seen: string[] = []
  const fetcher = async (url: string, init: RequestInit) => {
    seen.push(new URL(url).hostname)
    expect(new Headers(init.headers).get('range')).toBe('bytes=0-131071')
    await new Promise(resolve => setTimeout(resolve,url.includes('fast.')?5:70))
    return new Response(new Uint8Array(65536))
  }
  try {
    const first = await selectIQCDN(playlist,candidates,{preferencePath:path,headers:{},fetcher,now:1000})
    expect(first.hosts).toEqual(['fast.inter.iqiyi.com'])
    expect(seen.length).toBe(2)
    const stored=readFileSync(path,'utf8')
    expect(stored).not.toMatch(/secret|signature|http|bbts/)
    const next = await selectIQCDN(playlist,[{...candidates[0],urls:[slow,fast.replace('fresh-secret','new-secret')]}],{preferencePath:path,headers:{},fetcher,now:2000})
    expect(seen.length).toBe(2)
    expect(next.playlist).toContain('new-secret')
    expect(next.playlist).not.toContain('fresh-secret')
    const fallback = await selectIQCDN(playlist,candidates,{preferencePath:path,headers:{},fetcher,now:3000,excluded:new Set(['fast.inter.iqiyi.com'])})
    expect(fallback.hosts).toEqual(['slow.inter.iqiyi.com'])
  } finally { rmSync(dir,{recursive:true,force:true}) }
})

test('expired preference is measured again; a 200 HTML error cannot win a CDN probe', async () => {
  const dir = mkdtempSync(join(tmpdir(),'iq-cdn-expiry-')), path=join(dir,'preference.json')
  let calls=0
  try {
    writeFileSync(path,JSON.stringify({version:1,host:'fast.inter.iqiyi.com',checkedAt:1}))
    const result=await selectIQCDN(playlist,candidates,{preferencePath:path,headers:{},now:7*60*60*1000,fetcher:async url=>{
      calls++
      return url.includes('fast.')?new Response('<html>Error</html>',{headers:{'content-type':'text/html'}}):new Response(new Uint8Array(65536))
    }})
    expect(calls).toBe(2)
    expect(result.hosts).toEqual(['slow.inter.iqiyi.com'])
  } finally { rmSync(dir,{recursive:true,force:true}) }
})

test('low-speed failover ignores warmup, brief dips and merging', () => {
  let now=0
  const guard=iqCDNSlowGuard(()=>now)
  now=19000;expect(guard('download',0)).toBe(false)
  now=20000;expect(guard('download',1000)).toBe(false)
  now=39000;expect(guard('download',1000)).toBe(false)
  now=40000;expect(guard('download',1000000)).toBe(false)
  now=41000;expect(guard('download',1000)).toBe(false)
  now=61000;expect(guard('download',1000)).toBe(true)
  now=62000;expect(guard('merge',0)).toBe(false)
})
