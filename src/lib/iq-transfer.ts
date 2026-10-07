import { createHash } from 'node:crypto'
import { createWriteStream, readFileSync, statSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fetchMediaProbe } from './proxy.ts'
import { sleep } from './util.ts'

type Part = { url: string; path: string }
export async function downloadIQParts(parts: Part[], options: {
  identity: string; threads: number; headers: Record<string,string>; signal?: AbortSignal
  progress?: (bytes: number, completed: number, total: number) => void
  fetcher?: (url: string, init: RequestInit) => Promise<Response>
}): Promise<void> {
  options.signal?.throwIfAborted()
  const controller = new AbortController()
  const signal = options.signal ? AbortSignal.any([options.signal,controller.signal]) : controller.signal
  const bytes = parts.map(()=>0), complete = parts.map(()=>false)
  const identities = parts.map((part,index) => {
    const u = new URL(part.url)
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw new Error('IQ 音轨地址格式无效')
    return createHash('sha256').update(JSON.stringify([options.identity,index,u.pathname,...['m','qd_uri','start','end','contentlength'].map(k=>u.searchParams.get(k))])).digest('hex')
  })
  const report = () => options.progress?.(bytes.reduce((a,b)=>a+b,0),complete.filter(Boolean).length,parts.length)
  parts.forEach((part,index)=>{
    try {
      const old=JSON.parse(readFileSync(`${part.path}.complete.json`,'utf8'))
      if(old.identity===identities[index] && old.bytes>0 && statSync(part.path).size===old.bytes){bytes[index]=old.bytes;complete[index]=true}
    } catch { /* incomplete or older transfers are not trusted */ }
  })
  report()
  let next=0
  const worker = async () => {
    while(next<parts.length){
      signal.throwIfAborted()
      const index=next++, part=parts[index]!
      if(complete[index])continue
      for(let attempt=0;;attempt++){
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
        try {
          bytes[index]=0
          const response=await (options.fetcher??fetchMediaProbe)(part.url,{headers:options.headers,signal})
          if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw new Error(`IQ CDN HTTP ${response.status}`)}
          const expected=Number(response.headers.get('content-length'))||0
          reader=response.body.getReader()
          async function* chunks(){
            while(true){const {value,done}=await reader!.read();if(done)break;signal.throwIfAborted();bytes[index]!+=value.byteLength;report();yield value}
          }
          await pipeline(Readable.from(chunks()),createWriteStream(part.path),{signal})
          if(!bytes[index] || expected && bytes[index]!==expected)throw new Error('IQ 音轨下载字节数不完整')
          writeFileSync(`${part.path}.complete.json`,JSON.stringify({identity:identities[index],bytes:bytes[index]}))
          complete[index]=true;report();break
        } catch(error){
          signal.throwIfAborted()
          if(attempt>=2)throw error
          await sleep(700*(attempt+1),signal)
        } finally {await reader?.cancel().catch(()=>{});reader?.releaseLock()}
      }
    }
  }
  const count=Math.min(parts.length,Math.max(1,Math.min(16,Math.floor(options.threads)||1)))
  const workers=Array.from({length:count},worker)
  try {await Promise.all(workers)}
  catch(error){controller.abort(error);await Promise.allSettled(workers);throw error}
}
