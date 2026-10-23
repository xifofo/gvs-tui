// fingerprint-probe.ts —— 量出 TUI 侧三个客户端栈真实发出的 TLS 指纹。
//
// 背景：tx/yk 的上游请求经 egress 隧道交给 TUI 执行（gateway/internal/egress →
// TUI tunnel），所以线上对上游呈现的 JA3 是**这个进程**的，而不是网关 Go 的。
// 本探针不改线上行为，只对本地 ja3 回声服务发 3 个只读请求：
//
//   1. bun-fetch          —— 裸 fetch（Bun 自带 TLS 栈）
//   2. tunnel-localFetch  —— 隧道实际走的那条路径（import 自 src/lib/tunnel.ts）
//   3. node-tls           —— fake-IP 路由用的 node:tls 原始握手（tunnel.ts dial()）
//
// 用法（先从 gateway 仓库启动 scripts/ja3_listen.go）：
//
//   NODE_EXTRA_CA_CERTS=<gateway>/tmp/fingerprint/cert.pem \
//     bun run ../tui/scripts/fingerprint-probe.ts
//
// 输出：每个 arm 的 JA3 / JA3-MD5 / ALPN / TLS 版本；--out 可落盘 JSON。

import tls from 'node:tls'
import net from 'node:net'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { localFetch, localFetchH2, tunnelUsesH2, closeH2Sessions } from '../src/lib/tunnel.ts'

const URL_ = process.env.FP_URL ?? 'https://127.0.0.1:18443/'
const outIdx = process.argv.indexOf('--out')
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : ''

type Report = {
  arm: string
  ok: boolean
  ja3?: string
  ja3_md5?: string
  alpn?: string[]
  tls_version?: string
  ciphers?: number[]
  extensions?: number[]
  curves?: number[]
  error?: string
}

function parseReport(text: string): Partial<Report> {
  const t = text.trim()
  const i = t.indexOf('{')
  if (i < 0) return {}
  try {
    const j = JSON.parse(t.slice(i))
    return {
      ja3: j.ja3,
      ja3_md5: j.ja3_md5,
      alpn: j.alpn,
      tls_version: j.tls_version,
      ciphers: j.ciphers,
      extensions: j.extensions,
      curves: j.curves,
    }
  } catch {
    return {}
  }
}

async function viaFetch(): Promise<Report> {
  const res = await fetch(URL_)
  const text = await res.text()
  return { arm: 'bun-fetch', ok: true, ...parseReport(text) }
}

async function viaTunnelH2(): Promise<Report> {
  const u = new URL(URL_)
  if (!tunnelUsesH2(u.hostname)) {
    return { arm: 'tunnel-h2', ok: false, error: `host ${u.hostname} 不在 GVS_TUNNEL_H2_HOSTS 内` }
  }
  const frame = await localFetchH2({ t: 'req', method: 'GET', url: URL_, header: {} } as any, u)
  if (frame.err) return { arm: 'tunnel-h2', ok: false, error: frame.err }
  const text = Buffer.from(frame.body ?? '', 'base64').toString('utf8')
  return { arm: 'tunnel-h2', ok: true, ...parseReport(text) }
}

async function viaTunnel(): Promise<Report> {
  const frame = await localFetch({ t: 'req', method: 'GET', url: URL_, header: {} } as any, fetch as any)
  if (frame.err) return { arm: 'tunnel-localFetch', ok: false, error: frame.err }
  const text = Buffer.from(frame.body ?? '', 'base64').toString('utf8')
  return { arm: 'tunnel-localFetch', ok: true, ...parseReport(text) }
}

/** 复刻 tunnel.ts dial()：先 TCP，再 tls.connect({socket})。 */
function viaNodeTls(): Promise<Report> {
  return new Promise((resolve) => {
    const u = new URL(URL_)
    const raw = net.connect({ host: u.hostname, port: Number(u.port || 443), timeout: 8000 }, () => {
      // servername 不能是 IP（node:tls 会直接抛错）；与 tunnel.ts dial() 一致，IP 目标不传 SNI。
      const sni = /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) ? undefined : u.hostname
      const sock = tls.connect({ socket: raw, servername: sni, ALPNProtocols: ['http/1.1'], rejectUnauthorized: false }, () => {
        sock.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nConnection: close\r\n\r\n`)
      })
      const chunks: Buffer[] = []
      sock.on('data', (c) => chunks.push(c))
      sock.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        const split = text.indexOf('\r\n\r\n')
        const body = split >= 0 ? text.slice(split + 4) : text
        resolve({ arm: 'node-tls', ok: true, ...parseReport(body) })
      })
      sock.on('error', (e) => resolve({ arm: 'node-tls', ok: false, error: String(e) }))
    })
    raw.on('error', (e) => resolve({ arm: 'node-tls', ok: false, error: String(e) }))
    raw.on('timeout', () => resolve({ arm: 'node-tls', ok: false, error: 'timeout' }))
  })
}

const arms: Array<[string, () => Promise<Report>]> = [
  ['bun-fetch', viaFetch],
  ['tunnel-localFetch', viaTunnel],
  ['tunnel-h2', viaTunnelH2],
  ['node-tls', viaNodeTls],
]

const results: Report[] = []
for (const [name, fn] of arms) {
  try {
    results.push(await fn())
  } catch (e) {
    results.push({ arm: name, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}

for (const r of results) {
  if (r.ok) {
    console.log(`${r.arm.padEnd(20)} ja3_md5=${r.ja3_md5}  alpn=${JSON.stringify(r.alpn ?? [])}  ${r.tls_version ?? ''}`)
    console.log(`${''.padEnd(20)} ja3=${r.ja3}`)
  } else {
    console.log(`${r.arm.padEnd(20)} ERR ${r.error}`)
  }
}

closeH2Sessions()
if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), target: URL_, results }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
