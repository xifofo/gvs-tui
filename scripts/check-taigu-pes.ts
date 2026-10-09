import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createDecipheriv } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { defaultConfig, configPath } from '../src/lib/config.ts'
import { GwClient } from '../src/lib/client.ts'
import { reexecWithoutProxy } from '../src/lib/proxy.ts'
await reexecWithoutProxy()
process.env.GVS_TUI_LOG='0'
const cfg={...defaultConfig(),...JSON.parse(readFileSync(configPath(),'utf8'))}
const cli=new GwClient(cfg.host,cfg.key,()=>cfg)
const data=await cli.invoke('youku','play',{vid:'XNjQ3MzYyNjYzMg==',expand:'0',tier:'multi',nocache:'1'},cli.extra(cfg,'youku'))
const drm=data.drm as any
if(!/^[a-f0-9]{32}$/i.test(drm?.content_key_hex||''))throw new Error('No valid existing response key')
const key=Buffer.from(drm.content_key_hex,'hex')
const raw=readFileSync(resolve('tmp/taigu-stages-1790754625553/upstream-first-segment.ts'))
type PES={pid:number; spans:{offset:number,length:number}[]; bytes:Buffer}
const records:PES[]=[];const pending=new Map<number,{parts:Buffer[];spans:{offset:number,length:number}[]}>()
function flush(pid:number){const p=pending.get(pid);if(p){records.push({pid,spans:p.spans,bytes:Buffer.concat(p.parts)});pending.delete(pid)}}
for(let i=0;i+188<=raw.length;i+=188){
 if(raw[i]!==71)throw new Error('TS sync failed')
 const pid=((raw[i+1]!&31)<<8)|raw[i+2]!
 if(pid!==256&&pid!==257)continue
 const af=(raw[i+3]!>>4)&3;if(af===0||af===2)continue
 let off=i+4;if(af===3)off+=1+raw[i+4]!
 if(off>=i+188)continue
 if(raw[i+1]!&64){flush(pid);if(raw[off]!==0||raw[off+1]!==0||raw[off+2]!==1)continue;off+=9+raw[off+8]!;pending.set(pid,{parts:[],spans:[]})}
 const p=pending.get(pid);if(p&&off<i+188){p.parts.push(raw.subarray(off,i+188));p.spans.push({offset:off,length:i+188-off})}
}
for(const pid of pending.keys())flush(pid)
const root=resolve('tmp','taigu-pes-check-'+Date.now());mkdirSync(root,{recursive:true})
const iv=drm.iv||drm.constant_iv
const modes=[{name:'ecb',cipher:'aes-128-ecb',iv:null as Buffer|null},{name:'cbc-zero',cipher:'aes-128-cbc',iv:Buffer.alloc(16)}]
if(typeof iv==='string' && /^[a-f0-9]{32}$/i.test(iv))modes.push({name:'cbc-response-iv',cipher:'aes-128-cbc',iv:Buffer.from(iv,'hex')})
const reports:unknown[]=[]
for(const mode of modes){
 function decrypt(b:Buffer){const n=Math.floor(b.length/16)*16;const d=createDecipheriv(mode.cipher,key,mode.iv);d.setAutoPadding(false);return Buffer.concat([d.update(b.subarray(0,n)),d.final(),b.subarray(n)])}
 let audioHeaders=0,videoHeaders=0;const output=Buffer.from(raw)
 for(const record of records){
  const b=decrypt(record.bytes)
  if(record.pid===257 && b[0]===255 && (b[1]!&246)===240)audioHeaders++
  if(record.pid===256 && b[0]===0 && b[1]===0 && (b[2]===1 || b[2]===0&&b[3]===1))videoHeaders++
  let pos=0;for(const s of record.spans){b.copy(output,s.offset,pos,pos+s.length);pos+=s.length}
 }
 const report:any={mode:mode.name,audioPES:records.filter(r=>r.pid===257).length,videoPES:records.filter(r=>r.pid===256).length,audioHeaders,videoHeaders}
 if(audioHeaders>0&&videoHeaders>0){
  const path=join(root,mode.name+'.ts');writeFileSync(path,output)
  for(const stream of ['a','v']){const p=spawnSync(resolve('bin/ffmpeg.exe'),['-nostdin','-hide_banner','-loglevel','error','-xerror','-err_detect','explode','-i',path,'-map','0:'+stream+':0','-f','null','-'],{encoding:'utf8',timeout:45000,windowsHide:true});report[stream+'Exit']=p.status;writeFileSync(join(root,mode.name+'-'+stream+'.log'),p.stderr||'')}
 }
 reports.push(report)
}
writeFileSync(join(root,'summary.json'),JSON.stringify({root,reports,responseHasIV:!!iv},null,2));console.log(JSON.stringify({root,reports,responseHasIV:!!iv},null,2))
