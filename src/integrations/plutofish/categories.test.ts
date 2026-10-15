import { expect, test } from 'bun:test'
import { publicationCategoryError } from './categories'
import type { PlutoFishView } from './types'

const connection: PlutoFishView = { url: 'https://example.com', hasKey: true, status: 'verified', error: '',
  identity: { id: 'pub', name: 'Publisher', kind: 'publisher', sourceAccount: { id: 'source', alias: 'main', name: 'Source' },
    categories: [{ value: 'cn-series', label: '国产剧集' }] } }

test('分类必须来自当前身份，区分未连接、未返回、空列表和失效选项', () => {
  expect(publicationCategoryError(undefined, '')).toContain('请先连接')
  expect(publicationCategoryError({ ...connection, identity: { ...connection.identity!, categories: undefined } }, 'cn-series')).toContain('未返回')
  expect(publicationCategoryError({ ...connection, identity: { ...connection.identity!, categories: [] } }, '')).toContain('暂无')
  expect(publicationCategoryError(connection, '')).toBe('请选择资源分类')
  expect(publicationCategoryError(connection, 'deleted')).toContain('不可用')
  expect(publicationCategoryError(connection, 'cn-series')).toBe('')
})
