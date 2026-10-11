import { test, expect } from 'bun:test'
import { Runtime } from './runtime'
import { bilibiliOptions, mgtvOptions } from './lib/web-video-providers'
import { platformBar } from './scenes/shared'

for (const [provider, digit, title] of [['mgtv','7','芒果 TV'],['bilibili','8','哔哩哔哩']] as const) {
  test(`${provider} keyboard entry, paged detail and selected rendition survive confirmation`,async()=>{
    const runtime=new Runtime({simulate:true})
    try {
      await Bun.sleep(120)
      const x=runtime as any
      runtime.handleKey(digit,{ctrl:true});expect(x.discovery.view.provider).toBe(provider)
      const bar=platformBar([provider],58,provider)
      expect(bar.chunks.filter(c=>c.bg).map(c=>c.text).join('')).toContain(title)
      const first=provider==='mgtv'?'123':'BV17x411w7KC?p=1'
      const second=provider==='mgtv'?'456':'BV17x411w7KC?p=2'
      x.cli.invoke=async()=>({id:provider==='mgtv'?'clip:10':'BV17x411w7KC',title:'本地合成作品',episodes:[{id:first,vid:first,title:'第一集',number:1,isIntact:true},{id:second,vid:second,title:'第二集',number:2,isIntact:true}]})
      await x.detail(provider,provider==='mgtv'?'clip:10':'BV17x411w7KC')
      expect(runtime.snapshot.scene).toBe('detail')
      expect(runtime.snapshot.episodes).toHaveLength(2)
      const options=provider==='mgtv' ? mgtvOptions({qualities:[{quality:'11',name:'4K HDR',nominalHeight:2160,selectable:true}]}) : bilibiliOptions({media:[{type:'video',url:'https://cdn.invalid/v',quality:'80',codecFamily:'hevc',codec:'hev1.1.6',separate:true},{type:'audio',url:'https://cdn.invalid/a',quality:'30280',codecFamily:'aac',codec:'mp4a.40.2',group:'dash'}]})
      x.pending=[x.taskFromEp(1)]
      x.qualities=options.qualities;x.audios=options.qualities[0]?.audios||options.audios;x.qIdx=0;x.audioIdx=0
      x.applyOptions()
      expect(x.pending[0]).toMatchObject({provider,vid:second,quality:provider==='mgtv'?'11':'80|hevc',namingVersion:1})
      if(provider==='bilibili')expect(x.pending[0].audioTracks[0]?.id).toBe('30280|aac|mp4a.40.2|dash')
      const serialized=JSON.stringify(x.pending[0])
      expect(serialized).not.toContain('cdn.invalid');expect(serialized).not.toContain('cookie')
      x.scene='confirm';x.emit()
      expect(runtime.snapshot.confirmation?.quality).toBeTruthy()
    } finally {runtime.close()}
  })
}
