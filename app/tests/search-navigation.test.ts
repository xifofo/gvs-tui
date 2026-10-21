import { expect, test } from 'bun:test'
import { toCards } from '../src/main/cards'
import { mergeSearch } from '../src/shared/search-merge'
import type { Card } from '../src/shared/api'
import { openCard, store } from '../src/renderer/src/store'

test('clicking Tencent in the merged Jia Jin Chai result opens Tencent detail without searching again', async () => {
  const previous=globalThis.window
  const calls:Array<{method:string;args:unknown[]}>=[]
  globalThis.window={gvs:{call:async (method:string,...args:unknown[])=>{
    calls.push({method,args})
    if(method!=='detail') throw new Error('unexpected '+method)
    return {provider:args[0],id:args[1],title:'嫁金钗',poster:'',episodes:[]}
  }}} as unknown as Window & typeof globalThis
  try {
    const tencent=toCards('tencent',{items:[
      {id:'keyword',title:'嫁金钗',target:{type:'search',query:'嫁金钗'}},
      {id:'mzc00200gag6dkh',title:'嫁金钗',target:{type:'search',query:'嫁金钗'}},
    ]})
    const youku=toCards('youku',{items:[{showId:'youku-show',title:'嫁金钗'}]})
    const row=mergeSearch<Card>([{provider:'youku',cards:youku},{provider:'tencent',cards:tencent}])[0]!
    const selected=row.sources.find(c=>c.provider==='tencent')!
    store.view='search'
    store.query='嫁金钗'
    openCard(selected,row.sources.filter(c=>c!==selected))
    await new Promise(resolve=>setTimeout(resolve,0))
    expect(store.view).toBe('detail')
    expect(store.detail?.provider).toBe('tencent')
    expect(store.detail?.id).toBe('mzc00200gag6dkh')
    expect(store.detailAlternates.map(c=>c.provider)).toEqual(['youku'])
    expect(store.query).toBe('嫁金钗')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('detail')
    expect(calls[0]!.args.slice(0,2)).toEqual(['tencent','mzc00200gag6dkh'])
  } finally {
    globalThis.window=previous
    store.detail=null
    store.detailCard=null
    store.detailAlternates=[]
    store.view='home'
  }
})
