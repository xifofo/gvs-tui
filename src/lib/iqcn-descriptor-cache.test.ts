import {expect,test} from 'bun:test'
import {iqcnSegmentDescriptor,clearIQCNDescriptors,cachedIQCNDescriptor} from './iqcn-control'
import type {GwClient} from './client'

test('same-file batch serves following segments without control requests; refresh and scope invalidate',async()=>{
 let calls=0
 const cli={host:'https://fixture.invalid',key:'A',invoke:async(_p:string,_a:string,input:Record<string,unknown>)=>{
  calls++;expect(input.batch).toBe('1')
  return {transport:'local-v1',index:input.index,bytes:188,urls:['https://fixture.ptqy.gitv.tv/file?source='+calls],relatedSegments:Array.from({length:8},(_,index)=>({transport:'local-v1',index,bytes:188,urls:['https://fixture.ptqy.gitv.tv/file?source='+calls]}))}
 }} as unknown as GwClient
 await iqcnSegmentDescriptor(cli,{planId:'plan',index:0})
 for(let index=1;index<8;index++)await iqcnSegmentDescriptor(cli,{planId:'plan',index})
 expect(calls).toBe(1)
 await iqcnSegmentDescriptor(cli,{planId:'plan',index:2,refresh:'1'});expect(calls).toBe(2)
 const updated=await iqcnSegmentDescriptor(cli,{planId:'plan',index:3});expect(updated.urls).toEqual(['https://fixture.ptqy.gitv.tv/file?source=2'])
 clearIQCNDescriptors(cli,'plan');await iqcnSegmentDescriptor(cli,{planId:'plan',index:4});expect(calls).toBe(3)
 cli.key='B';await iqcnSegmentDescriptor(cli,{planId:'plan',index:4});expect(calls).toBe(4)
})

test('old gateways remain compatible and invalid batch descriptors are not trusted',async()=>{
 let calls=0
 const cli={host:'https://fixture.invalid',key:'A',invoke:async()=>{calls++;return {transport:'local-v1',index:0,bytes:188,urls:['https://fixture.ptqy.gitv.tv/file'],relatedSegments:[{transport:'local-v1',index:1,bytes:-1,urls:['https://fixture.ptqy.gitv.tv/file']}]}}} as unknown as GwClient
 await iqcnSegmentDescriptor(cli,{planId:'plan',index:0});await iqcnSegmentDescriptor(cli,{planId:'plan',index:1});expect(calls).toBe(2)
})

const row = (index: number, source = 'first') => ({
 transport:'local-v1', index, bytes:188, urls:[`https://fixture.ptqy.gitv.tv/${index}?source=${source}`],
})

test('refreshing one segment preserves siblings even without a related batch, and new batches merge',async()=>{
 let calls=0
 const cli={host:'https://fixture.invalid',key:'A',invoke:async(_p:string,_a:string,input:Record<string,unknown>)=>{
  calls++
  if(calls===1)return {...row(0),relatedSegments:[row(1),row(2)]}
  if(calls===2)return row(Number(input.index),'second')
  return {...row(Number(input.index),'third'),relatedSegments:[row(10,'third'),row(11,'third')]}
 }} as unknown as GwClient
 await iqcnSegmentDescriptor(cli,{planId:'plan',index:0})
 await iqcnSegmentDescriptor(cli,{planId:'plan',index:1,refresh:'1'})
 expect(cachedIQCNDescriptor(cli,'plan',0)?.urls).toEqual(row(0).urls)
 expect(cachedIQCNDescriptor(cli,'plan',2)?.urls).toEqual(row(2).urls)
 await iqcnSegmentDescriptor(cli,{planId:'plan',index:10})
 for(const index of [0,1,2,10,11])expect(cachedIQCNDescriptor(cli,'plan',index)).toBeDefined()
 expect(calls).toBe(3)
 // Callers cannot mutate the shared cached URL list.
 const copy=cachedIQCNDescriptor(cli,'plan',2)!
 ;(copy.urls as string[])[0]='https://fixture.ptqy.gitv.tv/modified'
 expect(cachedIQCNDescriptor(cli,'plan',2)?.urls).toEqual(row(2).urls)
})

test('cache lifetime is per entry and is not extended by reads or repeated URLs in another batch',async()=>{
 const originalNow=Date.now
 let now=originalNow(), calls=0
 Date.now=()=>now
 const cli={host:'https://fixture.invalid',key:'A',invoke:async(_p:string,_a:string,input:Record<string,unknown>)=>{
  calls++
  return {...row(Number(input.index)),relatedSegments:calls===1?[row(1)]:[row(1),row(3)]}
 }} as unknown as GwClient
 try{
  await iqcnSegmentDescriptor(cli,{planId:'plan',index:0})
  now+=30_000
  expect(cachedIQCNDescriptor(cli,'plan',1)).toBeDefined()
  await iqcnSegmentDescriptor(cli,{planId:'plan',index:2})
  now+=30_001
  expect(cachedIQCNDescriptor(cli,'plan',0)).toBeUndefined()
  expect(cachedIQCNDescriptor(cli,'plan',1)).toBeUndefined()
  expect(cachedIQCNDescriptor(cli,'plan',2)).toBeDefined()
  expect(cachedIQCNDescriptor(cli,'plan',3)).toBeDefined()
  now+=30_000
  expect(cachedIQCNDescriptor(cli,'plan',3)).toBeUndefined()
 }finally{Date.now=originalNow}
})

test('plans, gateway hosts, keys and selected accounts have separate descriptor scopes',async()=>{
 let account='one', calls=0
 const cli={host:'https://fixture.invalid',key:'A',accountFor:()=>account,invoke:async(_p:string,_a:string,input:Record<string,unknown>)=>{
  calls++;return {...row(Number(input.index)),relatedSegments:[row(1)]}
 }} as unknown as GwClient
 await iqcnSegmentDescriptor(cli,{planId:'plan',index:0})
 expect(cachedIQCNDescriptor(cli,'another-plan',1)).toBeUndefined()
 for(const change of [()=>{account='two'},()=>{cli.host='https://other.invalid'},()=>{cli.key='B'}]){
  change()
  expect(cachedIQCNDescriptor(cli,'plan',1)).toBeUndefined()
  await iqcnSegmentDescriptor(cli,{planId:'plan',index:1})
 }
 expect(calls).toBe(4)
})

test('a released plan is not recreated by an in-flight descriptor reply',async()=>{
 let entered!:()=>void, release!:(value:Record<string,unknown>)=>void
 const started=new Promise<void>(resolve=>{entered=resolve})
 const cli={host:'https://fixture.invalid',key:'A',invoke:()=>{
  entered();return new Promise<Record<string,unknown>>(resolve=>{release=resolve})
 }} as unknown as GwClient
 const pending=iqcnSegmentDescriptor(cli,{planId:'plan',index:0})
 await started
 clearIQCNDescriptors(cli,'plan')
 release({...row(0),relatedSegments:[row(1)]})
 await pending
 expect(cachedIQCNDescriptor(cli,'plan',0)).toBeUndefined()
 expect(cachedIQCNDescriptor(cli,'plan',1)).toBeUndefined()
})

test('reordering already rejected URLs does not count as a fresh replacement',async()=>{
 let calls=0
 const failed={...row(1),urls:['https://fixture.ptqy.gitv.tv/a','https://fixture.ptqy.gitv.tv/b']}
 const cli={host:'https://fixture.invalid',key:'A',invoke:async(_p:string,_a:string,input:Record<string,unknown>)=>{
  calls++
  return calls===1?{...row(0),relatedSegments:[{...failed,urls:[...failed.urls].reverse()}]}:row(Number(input.index),'new')
 }} as unknown as GwClient
 await iqcnSegmentDescriptor(cli,{planId:'plan',index:0})
 const refreshed=await iqcnSegmentDescriptor(cli,{planId:'plan',index:1,refresh:'1'},undefined,failed)
 expect(calls).toBe(2)
 expect(refreshed.urls).toEqual(row(1,'new').urls)
})

test('cancelling a queued refresh prevents a later request or stale cache return',async()=>{
 let entered!:()=>void, release!:(value:Record<string,unknown>)=>void, calls=0
 const started=new Promise<void>(resolve=>{entered=resolve})
 const cli={host:'https://fixture.invalid',key:'A',invoke:()=>{
  calls++;entered();return new Promise<Record<string,unknown>>(resolve=>{release=resolve})
 }} as unknown as GwClient
 const first=iqcnSegmentDescriptor(cli,{planId:'plan',index:0})
 await started
 const abort=new AbortController()
 const next=iqcnSegmentDescriptor(cli,{planId:'plan',index:1,refresh:'1'},abort.signal,row(1,'old'))
 // Observe the rejection before aborting, but assert after releasing the first request.
 const outcome=next.then(()=>({resolved:true}),error=>({error}))
 abort.abort(new Error('cancelled'))
 release({...row(0),relatedSegments:[row(1)]})
 await first
 expect(await outcome).toMatchObject({error:{message:'cancelled'}})
 expect(calls).toBe(1)
})
