import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { defaultConfig, configPath } from '../src/lib/config.ts'
import { GwClient } from '../src/lib/client.ts'
import { reexecWithoutProxy } from '../src/lib/proxy.ts'
await reexecWithoutProxy()
process.env.GVS_TUI_LOG='0'
const cfg={...defaultConfig(),...JSON.parse(readFileSync(configPath(),'utf8'))}
const cli=new GwClient(cfg.host,cfg.key,()=>cfg)
const data=await cli.invoke('youku','play',{vid:'XNjQ3MzYyNjYzMg==',expand:'0',tier:'multi',nocache:'1'},cli.extra(cfg,'youku'))
function safe(o:any):any {
 if (!o || typeof o!=='object') return typeof o
 if(Array.isArray(o)) return o.map(safe)
 const out:Record<string,unknown>={}
 for(const [k,v] of Object.entries(o)){
  if(['stream_type','media_type','type','scheme','need_decrypt','actually_clear','unwrap_ok','pattern_video','pattern_audio','width','height','fps','size','duration','h265','codecs','drm','drm_type','device_profile','audio_delivery','download_status','can_play','is_vip','trial','source','tier','name','err','container','ext'].includes(k)){
   if(typeof v==='string' && (v.includes('http') || v.length>180)) out[k]='<long value omitted>'; else out[k]=typeof v==='object'?safe(v):v
  } else if(k.includes('url')) {try{out[k+'Shape']={host:new URL(String(v)).hostname,extension:new URL(String(v)).pathname.split('.').at(-1)}}catch{out[k+'Present']=!!v}}
  else if(['iv','constant_iv','content_key_hex','copyright_key','kid','key_id'].includes(k)) out[k+'Present']=!!v
 }
 return out
}
const report={top:safe(data),drm:safe(data.drm),video:safe(data.video),streams:safe(data.streams),audio:safe(data.audio_tracks),qualities:safe(data.qualities),tiers:safe(data.tiers),rawKeys: data.raw&&typeof data.raw==='object'?Object.keys(data.raw):[]}
const dir=resolve('tmp','taigu-streams-'+Date.now());mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({dir,...report},null,2))
