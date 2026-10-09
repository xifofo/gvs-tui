import { expect, test } from 'bun:test'
import { Runtime } from '../runtime.ts'

test('terminal domestic login opens a QR scene and completes through its polling path', async () => {
  const runtime = new Runtime({ simulate: true })
  const state = runtime as any
  const calls: string[] = []
  state.simulated = false
  state.cfg.host = 'http://127.0.0.1:1'
  state.cfg.key = 'fixture-key'
  state.keyInfo = { scope: ['iqcn'], all: false }
  state.cli = {
    allows: (_scope: string[], _all: boolean, provider: string) => provider === 'iqcn',
    invoke: async (provider: string, action: string, input: Record<string, unknown>) => {
      expect([provider, action]).toEqual(['iqcn', 'login'])
      calls.push(String(input.op))
      return input.op === 'start'
        ? { state: 'pending', flowId: 'terminal-flow', url: 'https://passport.iqiyi.com/fixture', expiresAt: Math.floor(Date.now() / 1000) + 600, interval: 2 }
        : { state: 'authenticated', authenticated: true, summary: '爱奇艺国内版已登录' }
    },
  }
  try {
    expect(state.settingFields()).toContain('爱奇艺国内版扫码')
    await state.openSetting('爱奇艺国内版扫码')
    expect(state.scene).toBe('qr')
    expect(state.qrAscii.length).toBeGreaterThan(0)
    expect(runtime.snapshot.qrHint).toContain('爱奇艺 App')
    await Bun.sleep(2100)
    runtime.tickQR()
    await Bun.sleep(30)
    expect(calls).toEqual(['start', 'poll'])
    expect(state.scene).toBe('settings')
    expect(state.qrIQCN).toBe(false)
  } finally { runtime.close() }
}, 10000)
