import { expect, test } from 'bun:test'
import { toCards } from './cards'

test('desktop cards retain Apple TV covers, rank and the disabled playback reason', () => {
  const cards = toCards('appletvplus', {contentType:'rank', items:[{id:'umc.cmc.a',title:'作品',kind:'series',poster:'https://is1-ssl.mzstatic.com/image/test.jpg',rank:1,target:{type:'unavailable',reason:'当前仅浏览'}}]})
  expect(cards).toHaveLength(1)
  expect(cards[0]?.target).toBe('unavailable')
  expect(cards[0]?.reason).toBe('当前仅浏览')
  expect(cards[0]?.poster).toContain('mzstatic.com')
  expect(cards[0]?.rank).toBe(1)
})
