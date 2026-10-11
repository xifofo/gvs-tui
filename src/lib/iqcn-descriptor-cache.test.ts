import {expect,test} from 'bun:test'
import {iqcnSegmentDescriptor,clearIQCNDescriptors} from './iqcn-control'
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
