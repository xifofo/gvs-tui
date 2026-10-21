import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ED2K_CHUNK, Ed2kHasher, ed2kFile, ed2kLink, md4hex } from './ed2k'

const enc = (s: string) => new TextEncoder().encode(s)

test('MD4 matches RFC 1320 test vectors', () => {
  expect(md4hex(enc(''))).toBe('31d6cfe0d16ae931b73c59d7e0c089c0')
  expect(md4hex(enc('a'))).toBe('bde52cb31de33e46245e05fbdbd6fb24')
  expect(md4hex(enc('abc'))).toBe('a448017aaf21d8525fc10ae87aa6729d')
  expect(md4hex(enc('message digest'))).toBe('d9130a8164549fe818874806e1c7014b')
  expect(md4hex(enc('abcdefghijklmnopqrstuvwxyz'))).toBe('d79e1c308aa5bbcdeea8ed63df412da9')
  expect(md4hex(enc('12345678901234567890123456789012345678901234567890123456789012345678901234567890'))).toBe('e33b4ddc9c38f2199c3e7b164fcc0536')
})

test('incremental MD4 equals one-shot across odd split points', () => {
  const data = new Uint8Array(1000).map((_, i) => (i * 31) & 0xff)
  const h = new Ed2kHasher()
  for (let i = 0; i < data.length; i += 7) h.update(data.subarray(i, i + 7))
  expect(h.digest()).toBe(md4hex(data))
})

test('ed2k: small file is plain MD4; exact one chunk of zeros uses the eMule empty-tail rule', () => {
  expect(new Ed2kHasher().digest()).toBe('31d6cfe0d16ae931b73c59d7e0c089c0')
  const zeros = new Uint8Array(ED2K_CHUNK)
  // 公认向量：9728000 个 0 字节 → eMule("red") fc21d9af828f92a8df64beac3357425d；单块 MD4("blue") d7def262a127cd79096a108e7a9fc138
  expect(md4hex(zeros)).toBe('d7def262a127cd79096a108e7a9fc138')
  expect(new Ed2kHasher().update(zeros).digest()).toBe('fc21d9af828f92a8df64beac3357425d')
  // 一块减一字节：不追加空块
  expect(new Ed2kHasher().update(zeros.subarray(1)).digest()).toBe(md4hex(zeros.subarray(1)))
})

test('ed2kFile streams a file and builds the link', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ed2k-'))
  const p = join(dir, 'ab.mkv')
  writeFileSync(p, 'abc')
  const seen: number[] = []
  const r = await ed2kFile(p, (d) => seen.push(d))
  expect(r.sha1).toBe('A9993E364706816ABA3E25717850C26C9CD0D89D')
  expect(r.file.size).toBe(3)
  expect({ hash: r.hash, size: r.size, link: r.link }).toEqual({ hash: 'a448017aaf21d8525fc10ae87aa6729d', size: 3, link: 'ed2k://|file|ab.mkv|3|A448017AAF21D8525FC10AE87AA6729D|/' })
  expect(seen.at(-1)).toBe(3)
  expect(ed2kLink('x|y', 1, 'ab')).toBe('ed2k://|file|x_y|1|AB|/')
})
