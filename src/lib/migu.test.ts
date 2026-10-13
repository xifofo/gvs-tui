import { expect, test } from 'bun:test'
import { ProviderSessions } from './provider-session'
import { webVideoLink, webVideoDetail, probeWebVideo, miguOptions } from './web-video-providers'
import { needsTunnel } from './tunnel-policy'
import { sourceTag } from './name'
import { usesMeasuredNaming } from './completed-naming'

test('Migu links, TV namespaces and required tunnel',()=>{
  expect(webVideoLink('https://m.miguvideo.com/mgs/msite/prd/detail.html?cid=968181177')?.provider).toBe('migu')
  expect(webVideoLink('tv:968181178')).toEqual({provider:'migu',url:'tv:968181178'})
  expect(webVideoLink('https://miguvideo.com.evil.invalid/?cid=968181177')).toBeUndefined()
  expect(needsTunnel(p=>p==='migu')).toBe(true)
  expect(sourceTag('migu')).toBe('MIGU')
  expect(usesMeasuredNaming({provider:'migu',namingVersion:1})).toBe(true)
})

test('Migu preserves verified resolution and blocks protected catalog entries',async()=>{
  const fixture={recommendedQuality:'5',qualityOptions:[
    {id:'7',label:'原画 HDR',width:1920,height:800,hdrType:'CUVAHDR',available:false,unavailableReason:'protected_stream'},
    {id:'3',label:'720P',width:1728,height:720,available:true},
    {id:'5',label:'极清 2K',rateTypeDesc:'HDRVivid',width:2560,height:1066,hdrType:'CUVAHDR',available:true},
  ]}
  const choices=miguOptions(fixture)
  expect(choices.qualities.map(q=>q.id)).toEqual(['5','3'])
  expect(choices.qualities[0]).toMatchObject({width:2560,height:1066,hdr:'vivid'})
  const calls:unknown[]=[]
  await probeWebVideo(async(p,a,input)=>{calls.push({p,a,input});return fixture},'migu','968181177')
  await probeWebVideo(async(p,a,input)=>{calls.push({p,a,input});return fixture},'migu','tv:968181178')
  expect(calls).toEqual([
    {p:'migu',a:'qualities',input:{id:'968181177',terminal:'mobile',devicePreset:'max'}},
    {p:'migu',a:'qualities',input:{id:'tv:968181178',terminal:'tv',devicePreset:'max'}},
  ])
})

test('Migu keeps every same-tier App rendition with size, codec and duration',()=>{
  const variants=[
    ['9|h264|u111417|b1810|3840x1600',3840,1600,'h264',5622606240],
    ['9|h265|u121417|b1810|3840x1600|cuvahdr',3840,1600,'h265',4475407304],
    ['5|h265|u121414|b251|2560x1066|cuvahdr',2560,1066,'h265',3660280288],
    ['5|h265|u121415|b251|2560x1066',2560,1066,'h265',3557530392],
  ]as const
  const result=miguOptions({qualityOptions:variants.map(([id,width,height,codec,size])=>({id,width,height,codec,size,duration:2725,label:'臻享 超高清',available:true}))})
  expect(result.qualities).toHaveLength(4)
  expect(result.qualities.map(q=>q.id)).toEqual(variants.map(v=>v[0]))
  expect(result.qualities.map(q=>[q.codec,q.size,q.duration])).toEqual(variants.map(v=>[v[3],v[4],2725]))
})

test('Migu refuses incomplete episodes and retains App focus episode',async()=>{
  const fixture={id:'968082110',focusVid:'968181177',episodesComplete:true,episodes:[{id:'968181177',number:1}]}
  const data=await webVideoDetail(async(_p,_a,input)=>{expect(input.terminal).toBe('mobile');return fixture},'migu','968181177')
  expect(data.focusVid).toBe('968181177');expect(data.episode_groups).toEqual(['正片'])
  await expect(webVideoDetail(async()=>({...fixture,episodesComplete:false}),'migu','968181177')).rejects.toThrow('不完整')
  const tv=await webVideoDetail(async(_p,_a,input)=>{expect(input.terminal).toBe('tv');return {id:'tv:968181178',episodesComplete:false,episodesScope:'requested-episode',episodes:[{id:'tv:968181178',number:1}]}},'migu','tv:968181178')
  expect(tv.episodesComplete).toBe(false);expect((tv.episodes as unknown[]).length).toBe(1)
})

test('Migu QR polling has terminal binding, throttle and connection-scope isolation',async()=>{
  let now=100000;const calls:Record<string,unknown>[]=[]
  const sessions=new ProviderSessions(async(_p,_a,input)=>{
    calls.push(input)
    if(input.op==='start')return {state:'pending',loginId:'flow',qrCodeUrl:'https://passport.migu.cn/qrc/official?sessionid=abc',qrCodeDataUrl:'data:image/png;base64,AA==',expiresAt:300,pollIntervalMs:3000,token:'PRIVATE'}
    return {state:'authenticated',loggedIn:true,userToken:'PRIVATE'}
  },()=>now)
  const view=await sessions.command({provider:'migu',op:'start',terminal:'tv'})
  expect(view.url).toContain('passport.migu.cn');expect(JSON.stringify(view)).not.toContain('PRIVATE')
  await sessions.command({provider:'migu',op:'poll',terminal:'tv'});expect(calls.length).toBe(1)
  now+=3100
  expect((await sessions.command({provider:'migu',op:'poll',terminal:'tv'})).authenticated).toBe(true)
  expect(calls[1]).toMatchObject({terminal:'tv',loginId:'flow'})
  await sessions.command({provider:'migu',op:'start',terminal:'mobile'})
  sessions.setScope('different-key')
  await expect(sessions.command({provider:'migu',op:'poll',terminal:'mobile'})).rejects.toThrow('过期')
})

test('Migu QR rejects offsite authorization URLs',async()=>{
  const sessions=new ProviderSessions(async()=>({state:'pending',loginId:'flow',qrCodeUrl:'https://evil.invalid/qrc/test',qrCodeDataUrl:'data:image/png;base64,AA==',expiresAt:Date.now()/1000+300}))
  await expect(sessions.command({provider:'migu',op:'start'})).rejects.toThrow('无效')
})

test('Migu App and TV status requests stay independent',async()=>{
  const sent:Record<string,unknown>[]=[]
  const sessions=new ProviderSessions(async(_p,_a,input)=>{sent.push(input);await Promise.resolve();return {authenticated:input.terminal==='mobile'}})
  const [app,tv]=await Promise.all([sessions.command({provider:'migu',op:'status'}),sessions.command({provider:'migu',op:'status',terminal:'tv'})])
  expect(sent.map(i=>i.terminal)).toEqual(['mobile','tv'])
  expect(app).toMatchObject({terminal:'mobile',authenticated:true})
  expect(tv).toMatchObject({terminal:'tv',authenticated:false})
  expect(app.summary).toContain('咪咕 App')
  expect(tv.summary).toContain('咪咕 TV')
})

test('Migu TV series keeps TV episode identity through detail and probe',async()=>{
  const sent:Record<string,unknown>[]=[]
  const invoke=async(_p:string,action:string,input:Record<string,unknown>)=>{
    sent.push(input)
    return action==='detail' ? {id:'tv-series:968082109',terminal:'tv',episodesComplete:true,episodes:[{id:'tv:968181178',vid:'tv:968181178',number:1}]} : {recommendedQuality:'8',qualityOptions:[{id:'8',label:'TV 4K',width:3840,height:2160,available:true}]}
  }
  const detail=await webVideoDetail(invoke,'migu','tv-series:968082109')
  const first=(detail.episodes as Array<{vid:string}>)[0]!
  const choices=await probeWebVideo(invoke,'migu',first.vid)
  expect(sent).toEqual([{id:'tv-series:968082109',pageSize:100,terminal:'tv',devicePreset:'max'},{id:'tv:968181178',terminal:'tv',devicePreset:'max'}])
  expect(choices.qualities.map(q=>q.id)).toEqual(['8'])
  const partial=await webVideoDetail(async()=>({...detail,episodesComplete:false}),'migu','tv-series:968082109')
  expect(partial.episodesComplete).toBe(false)
  expect(partial.desc).toContain('TV 目录未完整')
  expect((partial.episodes as Array<{vid:string}>)[0]!.vid).toBe('tv:968181178')
})

test('Migu QR flows and logout remain scoped to their own terminal',async()=>{
  let now=100000
  const calls:Record<string,unknown>[]=[]
  const sessions=new ProviderSessions(async(_p,_a,input)=>{
    calls.push(input)
    if(input.op==='start')return {state:'pending',loginId:String(input.terminal)+'-flow',qrCodeUrl:'https://passport.migu.cn/qrc/official',qrCodeDataUrl:'data:image/png;base64,AA==',expiresAt:300,pollIntervalMs:3000}
    if(input.op==='logout')return {state:'signed_out'}
    return {state:'authenticated',authenticated:true}
  },()=>now)
  await sessions.command({provider:'migu',op:'start',terminal:'tv'})
  await sessions.command({provider:'migu',op:'start'})
  await sessions.command({provider:'migu',op:'logout',terminal:'tv'})
  now+=3100
  await sessions.command({provider:'migu',op:'poll'})
  expect(calls[3]).toMatchObject({terminal:'mobile',loginId:'mobile-flow'})
  await expect(sessions.command({provider:'migu',op:'poll',terminal:'tv'})).rejects.toThrow('过期')
})
