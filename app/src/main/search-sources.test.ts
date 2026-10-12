import { expect, test } from 'bun:test'
import { toCards } from './cards'
import { cardSourceName, providerSearchSources, splitSearchSources } from '../shared/search-sources'

test('Migu App and TV have independent filters and counts while retaining the real provider', () => {
  const cards = toCards('migu', {items:[
    {id:'tv-series:968082109',title:'伟大的长征',sourceTerminal:'tv',target:{type:'detail',id:'tv-series:968082109'}},
    {id:'968082110',title:'伟大的长征',sourceTerminal:'mobile'},
    {id:'clip-app',title:'花絮',sourceTerminal:'mobile'},
  ]})
  expect(cards.map(c=>c.sourceTerminal)).toEqual(['tv','mobile','mobile'])
  const groups=splitSearchSources([{provider:'migu',cards,error:''}])
  expect(groups.map(g=>[g.key,g.name,g.cards.length])).toEqual([
    ['migu-app','咪咕 App',2],['migu-tv','咪咕 TV（咪视界）',1],
  ])
  expect(groups.reduce((n,g)=>n+g.cards.length,0)).toBe(cards.length)
  expect(groups.every(g=>g.provider==='migu'&&g.cards.every(c=>c.provider==='migu'))).toBe(true)
  expect(groups[1]!.cards[0]!.id).toBe('tv-series:968082109')
  expect(groups[0]!.cards[0]!.id).toBe('968082110')
})

test('Migu source survives normalization and legacy namespaced cards', () => {
  const [tv]=toCards('migu',{items:[{id:'tv-series:123456',title:'电视作品'}]})
  expect(tv!.sourceTerminal).toBe('tv')
  expect(cardSourceName({provider:'migu',id:'tv:123456'})).toBe('咪咕 TV（咪视界）')
  expect(cardSourceName({provider:'migu',id:'123456'})).toBe('咪咕 App')
  expect(cardSourceName({provider:'youku',id:'tv-series:123456'})).toBe('优酷')
})

test('Pending, empty and failed Migu searches still expose both sources', () => {
  expect(providerSearchSources('migu').map(s=>s.key)).toEqual(['migu-app','migu-tv'])
  const groups=splitSearchSources([{provider:'migu',cards:[],error:'源站请求失败'}])
  expect(groups).toHaveLength(2)
  expect(groups.every(g=>g.error==='源站请求失败'&&g.cards.length===0)).toBe(true)
  expect(splitSearchSources([{provider:'youku',cards:[],error:''}])).toEqual([{provider:'youku',key:'youku',name:'优酷',cards:[],error:''}])
})
