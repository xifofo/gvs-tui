import { expect, test } from 'bun:test'
import { discoveryRows } from './discovery.ts'
import { parseEpisodes } from './episodes.ts'

test('normalized domestic catalog works in both terminal and Electron parsers', async () => {
  const desktopParserPath = '../../app/src/main/cards.ts'
  const { toCards } = await import(desktopParserPath)
  const search = { items: [{ id: '6343226711532601', title: 'fixture show', cover: 'https://example.invalid/poster', target: { type: 'detail', id: '6343226711532601' } }], hasMore: true, nextCursor: '2' }
  expect(discoveryRows('iqcn', search)).toHaveLength(1)
  expect(toCards('iqcn', search)[0]).toMatchObject({ id: '6343226711532601', title: 'fixture show', target: 'detail' })
  const detail = { id: '6343226711532601', title: 'fixture show', episodes: [{ id: '6334402890585900', vid: '6334402890585900', number: 1, title: 'episode 1', duration: 2920 }] }
  expect(parseEpisodes(detail)[0]).toMatchObject({ vid: '6334402890585900', number: 1, duration: 2920 })
})
