import { expect, test } from 'bun:test'
import { extractIQCNLink, extractIQLink } from './link.ts'

test('domestic and overseas IQ links stay separate and trim share punctuation', () => {
  const domestic = 'https://www.iqiyi.com/v_abc123.html'
  expect(extractIQCNLink(`分享：${domestic}。`)).toBe(domestic)
  expect(extractIQLink(domestic)).toBe('')
  expect(extractIQCNLink('https://www.iq.com/play/abc')).toBe('')
  for (const input of ['https://iqiyi.com.evil.invalid/v_abc123.html', 'https://user:pass@www.iqiyi.com/v_abc123.html', 'https://www.iqiyi.com:444/v_abc123.html', 'https://www.iqiyi.com/api/anything']) {
    expect(extractIQCNLink(input)).toBe('')
  }
})
