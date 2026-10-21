#!/usr/bin/env node
// Regenerates src/lib/user-message-catalog.ts from the gateway's user-message
// catalog. The gateway owns the wording; the client must not fork it.
//
//   node scripts/sync-user-messages.mjs [path/to/catalog.json]
//   GVS_GATEWAY_CATALOG=/path/to/gateway/internal/usermsg/catalog.json node scripts/sync-user-messages.mjs
//
// Without an explicit path it looks next to this checkout (../get_video_streaming)
// and in ~/Code/get_video_streaming. Every rule is validated so a truncated or
// hand-edited catalog fails loudly instead of silently shipping wrong wording.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(repo, 'src/lib/user-message-catalog.ts')

const candidates = [
  process.argv[2],
  process.env.GVS_GATEWAY_CATALOG,
  join(repo, '..', 'get_video_streaming', 'internal/usermsg/catalog.json'),
  join(homedir(), 'Code', 'get_video_streaming', 'internal/usermsg/catalog.json'),
].filter(Boolean)

const source = candidates.find((path) => existsSync(path))
if (!source) {
  console.error('catalog.json not found; pass the path or set GVS_GATEWAY_CATALOG')
  console.error('tried:\n  ' + candidates.join('\n  '))
  process.exit(1)
}

let rules
try {
  rules = JSON.parse(readFileSync(source, 'utf8'))
} catch (error) {
  console.error(`cannot parse ${source}: ${error.message}`)
  process.exit(1)
}
if (!Array.isArray(rules) || rules.length < 10) {
  console.error(`${source}: expected a non-trivial rule array, got ${Array.isArray(rules) ? rules.length : typeof rules}`)
  process.exit(1)
}

// 同一个 code 允许对应多条 pattern（例如 MEMBERSHIP_REQUIRED），只校验字段完整。
for (const [index, rule] of rules.entries()) {
  const where = `${source}[${index}]`
  if (typeof rule?.pattern !== 'string' || !rule.pattern) throw new Error(`${where}: pattern missing`)
  if (typeof rule?.code !== 'string' || !rule.code) throw new Error(`${where}: code missing`)
  if (typeof rule?.message !== 'string' || !rule.message) throw new Error(`${where}: message missing`)
}

const header = '// Generated from gateway/internal/usermsg/catalog.json; run scripts/sync-user-messages.mjs.\n'
writeFileSync(outFile, `${header}export const errorCatalog = ${JSON.stringify(rules, null, 2)}\n`, 'utf8')
console.log(`wrote ${rules.length} rules from ${source}`)
