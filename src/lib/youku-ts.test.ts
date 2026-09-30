import { expect, test } from 'bun:test'
import { createCipheriv } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decryptYoukuTs } from './youku-ts.ts'

const key = '0123456789abcdef0123456789abcdef'
function payload(kind: 'audio'|'video', n: number) {
  const p = Buffer.alloc(n, 0x35)
  ;(kind === 'audio' ? Buffer.from([255,241,80,128,0,31,252]) : Buffer.from([0,0,0,1,0x26,1])).copy(p)
  return p
}
function crypt(p: Buffer) {
  const n = Math.floor(p.length/16)*16
  const c = createCipheriv('aes-128-ecb', Buffer.from(key,'hex'), null);c.setAutoPadding(false)
  return Buffer.concat([c.update(p.subarray(0,n)),c.final(),p.subarray(n)])
}
function packetize(p: Buffer, pid: number, stream: number, cc = 0) {
  const header = Buffer.from([0,0,1,stream,0,0,0x80,0x80,5,0x21,0,1,0,1])
  if(stream < 0xe0) header.writeUInt16BE(p.length+8,4)
  const pes = Buffer.concat([header,p]);const packets:Buffer[]=[]
  for(let at=0;at<pes.length;){
    const take=Math.min(184,pes.length-at);const ts=Buffer.alloc(188,255)
    ts[0]=71;ts[1]=(pid>>8)|(at===0?64:0);ts[2]=pid&255;ts[3]=(take===184?16:48)|(cc++&15)
    let offset=4
    if(take<184){ts[4]=183-take;if(ts[4]>0)ts[5]=0;offset=188-take}
    pes.copy(ts,offset,at,at+take);at+=take;packets.push(ts)
  }
  return packets
}
function fixture(encrypted: boolean) {
  const a=payload('audio',413),v=payload('video',877)
  const ap=packetize(encrypted?crypt(a):a,301,0xc0)
  const vp=packetize(encrypted?crypt(v):v,300,0xe0)
  const packets:Buffer[]=[]
  for(let i=0;i<Math.max(ap.length,vp.length);i++){if(vp[i])packets.push(vp[i]!);if(ap[i])packets.push(ap[i]!)}
  return Buffer.concat(packets)
}
test('interleaved PES restores bytes exactly without changing headers, PTS or partial blocks',async()=>{
  const root=mkdtempSync(join(tmpdir(),'gvs-ts-'));const src=join(root,'in.ts'),dest=join(root,'out.ts')
  try{const encrypted=fixture(true);writeFileSync(src,encrypted);const stats=await decryptYoukuTs(src,dest,key);expect(readFileSync(dest)).toEqual(fixture(false));expect(readFileSync(src)).toEqual(encrypted);expect(stats).toEqual({audioPES:1,videoPES:1,bytes:encrypted.length})}
  finally{rmSync(root,{recursive:true,force:true})}
})
test('wrong key, missing packet and partial TS are rejected without leaving an output',async()=>{
  const root=mkdtempSync(join(tmpdir(),'gvs-ts-invalid-'));const src=join(root,'in.ts'),dest=join(root,'out.ts')
  try{
    writeFileSync(src,fixture(true));await expect(decryptYoukuTs(src,dest,'00'.repeat(16))).rejects.toThrow('密钥或格式');expect(existsSync(dest)).toBe(false)
    const corrupt=fixture(true);corrupt[188*2+3]=(corrupt[188*2+3]!&240)|9;writeFileSync(src,corrupt);await expect(decryptYoukuTs(src,dest,key)).rejects.toThrow('连续性');expect(existsSync(dest)).toBe(false)
    writeFileSync(src,fixture(true).subarray(0,-1));await expect(decryptYoukuTs(src,dest,key)).rejects.toThrow('长度不完整')
  }finally{rmSync(root,{recursive:true,force:true})}
})
test('cancellation and existing destinations cannot overwrite data',async()=>{
  const root=mkdtempSync(join(tmpdir(),'gvs-ts-cancel-'));const src=join(root,'in.ts'),dest=join(root,'out.ts')
  try{
    writeFileSync(src,fixture(true));const controller=new AbortController();controller.abort(new Error('cancelled'));await expect(decryptYoukuTs(src,dest,key,controller.signal)).rejects.toThrow('cancelled');expect(existsSync(dest)).toBe(false)
    writeFileSync(dest,'keep');await expect(decryptYoukuTs(src,dest,key)).rejects.toThrow();expect(readFileSync(dest,'utf8')).toBe('keep')
    await expect(decryptYoukuTs(src,src,key)).rejects.toThrow('独立输出')
  }finally{rmSync(root,{recursive:true,force:true})}
})
