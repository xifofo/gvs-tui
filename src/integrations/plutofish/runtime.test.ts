import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Runtime } from '../../runtime.ts'
import { GwClient } from '../../lib/client.ts'
import { defaultConfig, saveConfig } from '../../lib/config.ts'
import { savePlutoFishConfig } from './config.ts'

const oldAppData = process.env.APPDATA
const dirs: string[] = [], runtimes: Runtime[] = []
const keyInfo = { id: 'fixture', name: 'Fixture gateway', prefix: 'fixture', scope: [], all: false, qps: 1, daily: 0, usedToday: 0, expiresAt: null, permanent: true, daysLeft: null }
const identity = { id: 'fixture', name: 'Fixture publisher', kind: 'legacy', sourceAccount: null }
afterEach(() => {
  runtimes.splice(0).forEach(r => r.close())
  mock.restore()
  if (oldAppData === undefined) delete process.env.APPDATA
  else process.env.APPDATA = oldAppData
  dirs.splice(0).forEach(p => rmSync(p, { recursive: true, force: true }))
})
function prepare(savedPublisher = true) {
  const dir = mkdtempSync(join(tmpdir(), 'gvs-auth-runtime-')); dirs.push(dir); process.env.APPDATA = dir
  saveConfig({ ...defaultConfig(), host: 'http://127.0.0.1:9876', key: 'fixture-gateway' })
  if (savedPublisher) savePlutoFishConfig({ url: 'http://127.0.0.1:9877', key: 'fixture-publisher' })
  spyOn(Runtime.prototype as any, 'ensureBins').mockResolvedValue(undefined)
  spyOn(Runtime.prototype as any, 'bootRunLog').mockImplementation(() => {})
}
function start() { const r = new Runtime(); runtimes.push(r); return r }
async function settle(r: Runtime) {
  for (let i = 0; i < 100 && (r as any).connectingBoth; i++) await Bun.sleep(2)
  expect((r as any).connectingBoth).toBe(false)
}

test('saved gateway alone cannot enter through shortcuts or queue a task', async () => {
  prepare(false)
  const gateway = spyOn(GwClient.prototype, 'keyInfo').mockResolvedValue(keyInfo)
  const r = start()
  for (const key of ['f1', 'f2', 'f3', 'f4', 'escape', '1']) {
    r.handleKey(key, { alt: key === '1' }); expect(r.snapshot.scene).toBe('setup')
  }
  ;(r as any).enqueueAll([{}])
  expect(r.snapshot.jobs).toEqual([])
  expect(gateway).not.toHaveBeenCalled()
})

test('valid publisher still waits for gateway verification before entering', async () => {
  prepare()
  spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(identity))
  let resolve!: (value: typeof keyInfo) => void
  spyOn(GwClient.prototype, 'keyInfo').mockImplementation(() => new Promise(r => { resolve = r }))
  const r = start()
  expect(r.snapshot.scene).toBe('setup')
  for (let i = 0; i < 100 && !resolve; i++) await Bun.sleep(2)
  expect(r.snapshot.plutofish?.status).toBe('verified')
  r.handleKey('f2'); expect(r.snapshot.scene).toBe('setup')
  resolve(keyInfo)
  await settle(r)
  expect(r.snapshot.scene).toBe('workspace')
  expect(JSON.stringify(r.snapshot)).not.toContain('fixture-publisher')
})

test.each(['publisher', 'gateway'])('%s failure keeps the real runtime locked', async service => {
  prepare()
  spyOn(globalThis, 'fetch').mockResolvedValue(service === 'publisher' ? Response.json({}, { status: 401 }) : Response.json(identity))
  const gateway = spyOn(GwClient.prototype, 'keyInfo').mockImplementation(async () => {
    if (service === 'gateway') throw new Error('网关凭据无效')
    return keyInfo
  })
  const r = start()
  await settle(r)
  expect(r.snapshot.scene).toBe('setup')
  if (service === 'publisher') expect(gateway).not.toHaveBeenCalled()
  r.handleKey('f3'); expect(r.snapshot.scene).toBe('setup')
})

test('restart revalidates both stored credentials and runtime revocation closes the entry gate', async () => {
  prepare()
  let revoked = false, checks = 0
  spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => { ++checks; return Response.json(revoked ? {} : identity, { status: revoked ? 401 : 200 }) }, { preconnect: () => {} }))
  const gateway = spyOn(GwClient.prototype, 'keyInfo').mockResolvedValue(keyInfo)
  const first = start(); await settle(first); expect(first.snapshot.scene).toBe('workspace'); first.close()
  const second = start(); expect(second.snapshot.scene).toBe('setup'); await settle(second)
  expect(checks).toBe(2); expect(gateway).toHaveBeenCalledTimes(2)
  revoked = true
  await expect((second as any).plutofish.verify(undefined, true)).rejects.toThrow()
  expect(second.snapshot.scene).toBe('setup')
  second.handleKey('f4'); expect(second.snapshot.scene).toBe('setup')
})
