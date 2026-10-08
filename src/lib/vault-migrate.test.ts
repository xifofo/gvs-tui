import { test, expect } from 'bun:test'
import { defaultConfig } from './config.ts'
import { hasLocalCredentials, migrateLocalCredentials, pushLocalCredential } from './vault-migrate.ts'

type Call = [string, string, Record<string, unknown>, Record<string, string> | undefined]

function recordingCli(reply: () => Promise<Record<string, unknown>> = async () => ({ logged_in: true, imported: true, persisted: true, bound: true })) {
  const calls: Call[] = []
  const cli = {
    invoke: async (p: string, a: string, input: Record<string, unknown>, extra?: Record<string, string>) => {
      calls.push([p, a, input, extra])
      return reply()
    },
  }
  return { cli, calls }
}

test('vault migrate pushes each credential and clears local fields', async () => {
  const cfg = defaultConfig()
  cfg.tencentCookie = 'vusession=abc'
  cfg.youkuSign = 'yk_live_1'
  cfg.douyinCookie = 'sessionid=dy'
  cfg.iqCookie = 'P00001=iq'
  expect(hasLocalCredentials(cfg)).toBe(true)

  const { cli, calls } = recordingCli()
  const result = await migrateLocalCredentials(cli, cfg)

  expect(result.migrated.sort()).toEqual(['douyinCookie', 'iqCookie', 'tencentCookie', 'youkuSign'])
  expect(cfg.tencentCookie).toBe('')
  expect(cfg.youkuSign).toBe('')
  expect(cfg.douyinCookie).toBe('')
  expect(cfg.iqCookie).toBe('')
  expect(hasLocalCredentials(cfg)).toBe(false)

  // youku 迁移走 cred bind + Yk-Sign 头
  const youku = calls.find(([p]) => p === 'youku')!
  expect(youku[1]).toBe('cred')
  expect(youku[2].method).toBe('bind')
  expect(youku[3]).toEqual({ 'Yk-Sign': 'yk_live_1' })

  // tencent / douyin / iq 走各自的 login 导入
  const tx = calls.find(([p]) => p === 'tencent')!
  expect(tx[2]).toEqual({ method: 'cookie', cookie: 'vusession=abc' })
  const dy = calls.find(([p]) => p === 'douyin')!
  expect(dy[2]).toEqual({ op: 'import', cookie: 'sessionid=dy' })
  const iq = calls.find(([p]) => p === 'iq')!
  expect(iq[2]).toEqual({ op: 'import', cookie: 'P00001=iq' })
})

test('vault migrate keeps fields when the gateway is offline', async () => {
  const cfg = defaultConfig()
  cfg.youkuSign = 'yk_live_1'
  const { cli } = recordingCli(async () => {
    throw new Error('http 503')
  })
  const result = await migrateLocalCredentials(cli, cfg)
  expect(result.kept).toEqual(['youkuSign'])
  expect(cfg.youkuSign).toBe('yk_live_1')
})

test('vault migrate retains credentials when bind is unsupported or cannot find them', async () => {
  const cfg = defaultConfig()
  cfg.youkuSign = 'yk_dead'
  const { cli } = recordingCli(async () => {
    throw new Error('yk_sign not found or revoked')
  })
  const result = await migrateLocalCredentials(cli, cfg)
  expect(result.kept).toEqual(['youkuSign'])
  expect(cfg.youkuSign).toBe('yk_dead')
})

test('a successful envelope without durable acknowledgement cannot clear credentials', async () => {
  const cfg = defaultConfig()
  cfg.iqCookie = 'P00001=retained'
  const { cli } = recordingCli(async () => ({ imported: true, persisted: false }))
  expect((await migrateLocalCredentials(cli, cfg)).kept).toEqual(['iqCookie'])
  expect(cfg.iqCookie).toBe('P00001=retained')
  await expect(pushLocalCredential(cli, 'iq', cfg.iqCookie)).rejects.toThrow('未确认')
})

test('invalid API key errors preserve every original credential', async () => {
  const cfg = defaultConfig()
  cfg.tencentCookie = 'vusession=retained'
  const { cli } = recordingCli(async () => { throw new Error('invalid API key') })
  expect((await migrateLocalCredentials(cli, cfg)).kept).toEqual(['tencentCookie'])
  expect(cfg.tencentCookie).toBe('vusession=retained')
})

test('a slow migration cannot erase a newer local credential', async () => {
  const cfg = defaultConfig()
  cfg.tencentCookie = 'vusession=old'
  const { cli } = recordingCli(async () => { cfg.tencentCookie = 'vusession=new'; return { logged_in: true } })
  expect((await migrateLocalCredentials(cli, cfg)).kept).toEqual(['tencentCookie'])
  expect(cfg.tencentCookie).toBe('vusession=new')
})

test('empty config needs no migration', async () => {
  const cfg = defaultConfig()
  expect(hasLocalCredentials(cfg)).toBe(false)
  const { cli, calls } = recordingCli()
  const result = await migrateLocalCredentials(cli, cfg)
  expect(result).toEqual({ migrated: [], clearedDead: [], kept: [] })
  expect(calls).toHaveLength(0)
})
