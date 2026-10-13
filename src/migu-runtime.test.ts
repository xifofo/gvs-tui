import { test, expect } from 'bun:test'
import { Runtime } from './runtime'
import { miguOptions } from './lib/web-video-providers'

test('Migu TUI hotkey, detail, verified HDR selection and persisted task',async()=>{
  const runtime=new Runtime({simulate:true})
  try {
    await Bun.sleep(120)
    const x=runtime as any
    runtime.handleKey('9',{ctrl:true});expect(x.discovery.view.provider).toBe('migu')
    x.cli.invoke=async()=>({id:'968082110',title:'本地测试',episodesComplete:true,focusVid:'968181177',episodes:[{id:'968181177',vid:'968181177',title:'第1集',number:1}]})
    await x.detail('migu','968181177');expect(runtime.snapshot.episodes?.[0]?.vid).toBe('968181177')
    const options=miguOptions({recommendedQuality:'5',qualityOptions:[{id:'5',label:'App · 极清2K',available:true,width:2560,height:1066,hdrType:'CUVAHDR'}]})
    x.pending=[x.taskFromEp(0)]
    x.qualities=options.qualities;x.audios=options.qualities[0]?.audios||options.audios;x.qIdx=0;x.audioIdx=0;x.applyOptions()
    expect(x.pending[0]).toMatchObject({provider:'migu',vid:'968181177',quality:'5',namingVersion:1})
    expect(JSON.stringify(x.pending[0])).not.toContain('userToken')
  } finally {runtime.close()}
})
