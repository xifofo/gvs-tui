// tunnel-h2.test.ts —— 上游 h2 通道的匹配规则与端到端行为。
//
// 证书是测试专用的自签证书（仅用于 127.0.0.1），不进生产路径。

import { afterAll, describe, expect, test } from 'bun:test'
import http2 from 'node:http2'
import { closeH2Sessions, h2HostMatches, localFetchH2, tunnelUsesH2 } from './tunnel.ts'

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIICyTCCAbGgAwIBAgIJAKoOZdo/l455MA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNV
BAMMCWxvY2FsaG9zdDAeFw0yNjEwMjMwOTQxNDlaFw0yNjEwMjUwOTQxNDlaMBQx
EjAQBgNVBAMMCWxvY2FsaG9zdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoC
ggEBAJkTnB21w0KyEDtqsMAn4Nyk/p+11hqsaGQRxa6Hav2LijJC0f1xqZIZoaX9
a5JSFSGrr8VgC1EMnqwlx3bg2wPiYnfWgMMSGOz32jeavYNnUuQxTZf/6MTTy4eN
CHrRuFx6iIwTenNIpOLoXwmaAwxXC6WUT3d6eEwMYrYkql44eK8ipMYOvzNQV4LA
e0CZn9tHGR0en7UsOdpGp5ksAq+Vzi8RKdqW9Sj7X5YqXbsimKVvrAYxGdUCl2Ir
fs00CTwpiVG2rRaK8l4DS/3B/VGu0RB7+h58ALIaKf1//KlGXyEd/yviYXPduEr1
ouNaiUKNM36C4m+pY06JjO3/Bd0CAwEAAaMeMBwwGgYDVR0RBBMwEYIJbG9jYWxo
b3N0hwR/AAABMA0GCSqGSIb3DQEBCwUAA4IBAQCQCXCiNfhfGavWCAQOvW+2RUHt
ZR3DC30dmq2CVRTggV7RnDVvSYWB4JPw1qvkgytQSjm+g9YbGZ5mHABmS50095s0
i4hd+QNXQ2oz/fRSog3J68Tfb0BTo2DWo0ioxUkjcZkqs9NGFfV6N3YG9IyBwZFj
tWUrMIpYsph/62orkPeUCWd17fX4dFUTLcy9ehXBeVN2ot9/0wkYMN21qU55ednT
nLjbiYKG6lhN/gHn5XULxGceSNEuhEIavKaGNLmTBb29U3DUskIalwD2chgxTaUn
e6JlET5GAaspsyF6xHBlmidLxZ7hGm3CJbb3RcDXzcA7HaHvow5eFYBNHLce
-----END CERTIFICATE-----`
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCZE5wdtcNCshA7
arDAJ+DcpP6ftdYarGhkEcWuh2r9i4oyQtH9camSGaGl/WuSUhUhq6/FYAtRDJ6s
Jcd24NsD4mJ31oDDEhjs99o3mr2DZ1LkMU2X/+jE08uHjQh60bhceoiME3pzSKTi
6F8JmgMMVwullE93enhMDGK2JKpeOHivIqTGDr8zUFeCwHtAmZ/bRxkdHp+1LDna
RqeZLAKvlc4vESnalvUo+1+WKl27Ipilb6wGMRnVApdiK37NNAk8KYlRtq0WivJe
A0v9wf1RrtEQe/oefACyGin9f/ypRl8hHf8r4mFz3bhK9aLjWolCjTN+guJvqWNO
iYzt/wXdAgMBAAECggEADsmZLDmR2lCPRt4gov93Nnlt64nKXBtJnlklKp4EVOf0
+rP/yyb+xZFaT0my6ZiqV+1Y9o03qqW4clLX+QDxx2dIMeFz4ORPqhyrZPG62wXR
OSAWKdfb6Z+4KqkSJ6M41x4zMKz1CEv9ObpO7AOHxdpm0qEIKDeZhWcw5f2Ww7E0
oCJohMwUewRkJmkqXHn6tuaMB29wZt74fskuRmz81mHRsR76zcjGDlwexHQ1QAxb
7GbYa++OjtkLFyT+t1kCeu26OCbojzjjdN0mvn5vIAD46HnOuf7RUEXNTfWh7pzL
Wk0poFX9fZsFKhSHSIX2ODj1Q0zfvbOe01eDYTiG9QKBgQDGUwus0aeu2+TE8Mmy
BAtK2dF9mAVwOeRfyGZiKNtNsL1CAVG6/i0LcSrh/kq4bgBjBEF1UG3+4uctfQ0D
CP+veufzc3IWG3oPJO3SX0FTazNuzrepoNXUoINO9dSnywIylLRem6aFctOhYoEw
h4Fed/hNr9mAguh3yEYD2SzSFwKBgQDFl+79z0IYGewclgkIK1tgAlai66ABaZhY
Uhn4i6OrwtpS4iVVrc7jUuEQbvQT7HeSKB/oEii9w9L0dh5y2030GfbakuPg7su2
9KRFMCVLONiXnT6VpO5MIXnW9KBgtL/o0HxkdJdVIEaXScGVdIEbqSyiWYNe/Xq+
CRnRG8ekKwKBgHpULxdiGnQY3ns7qq1LIUwCHt3BL1mR2/PYwI47dUnugk58UdVt
gotUOoc7OwuXjlWFAntCKRbXDpFYWPZOTqgGv5vC0dQhDqDYvnjMmJbDwO3QRCk1
M6/7cgL6TzlQVwKsBrV0fLpDoZYiFF3Ct2F1zorctOQ32vxHZChrhOHxAoGAM6G4
5H+U8MFNTkbyQz05GkRiKR5S6CuUkHebq7OpaAd5jzDiupm5NvOANhAYHWCr+fgc
JkMgfD3AUPrQiAjAPOnP9FtvymX7u2n/xsiG5joLdsqzAN1hG2mf8choY/y3LPnV
l1ZT+P1/FKdEO25/EiBJtn6Xcmnf+epc4aRVrZMCgYAm/DZywxi5mC7I9g+DMr2U
5YSWA3NEnuZu9BuaPqH4TZQUdNlMY1y+fI4aquhaF0L6ix8679HPXe+iAewkwv8a
F/rF+htgglJTJAYJWRFg62oXYFI5s2HiAjFBwHEJNmQzCPi8uKxfQgv3BTdL/9nz
Jl8XDgXgza9yI8C6cqkcOQ==
-----END PRIVATE KEY-----`

describe('h2 host matching', () => {
  test('suffix semantics', () => {
    expect(h2HostMatches(['.youku.com'], 'acs.youku.com')).toBe(true)
    expect(h2HostMatches(['.youku.com'], 'youku.com')).toBe(true)
    expect(h2HostMatches(['.youku.com'], 'notyouku.com')).toBe(false)
    expect(h2HostMatches(['.qq.com'], 'vv.video.qq.com')).toBe(true)
    expect(h2HostMatches(['acs.youku.com'], 'acs.youku.com')).toBe(true)
    expect(h2HostMatches(['acs.youku.com'], 'ups.youku.com')).toBe(false)
  })

  test('env gate', () => {
    expect(tunnelUsesH2('acs.youku.com')).toBe(true)
    expect(tunnelUsesH2('example.com')).toBe(false)
    process.env.GVS_TUNNEL_H2 = '0'
    expect(tunnelUsesH2('acs.youku.com')).toBe(false)
    delete process.env.GVS_TUNNEL_H2
  })
})

describe('localFetchH2', () => {
  const srv = http2.createSecureServer({ key: TEST_KEY, cert: TEST_CERT }, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'x-proto': req.httpVersion })
    res.end(JSON.stringify({ path: req.url, proto: req.httpVersion }))
  })

  const listening = new Promise<number>((resolve) => {
    srv.listen(0, '127.0.0.1', () => resolve((srv.address() as any).port))
  })

  afterAll(() => {
    closeH2Sessions()
    srv.close()
  })

  test('returns a real h2 response', async () => {
    process.env.GVS_TUNNEL_H2_INSECURE = '1'
    const port = await listening
    const url = new URL(`https://127.0.0.1:${port}/api?x=1`)
    const frame = await localFetchH2(
      { t: 'req', id: '1', method: 'GET', url: url.toString(), header: { 'x-probe': ['h2'] } } as any,
      url,
    )
    expect(frame.status).toBe(200)
    expect(frame.header['x-proto']?.[0]).toBe('2.0')
    const body = JSON.parse(Buffer.from(frame.body ?? '', 'base64').toString('utf8'))
    expect(body.path).toBe('/api?x=1')
    expect(body.proto).toBe('2.0')
    delete process.env.GVS_TUNNEL_H2_INSECURE
  })
})
