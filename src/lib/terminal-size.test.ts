import { expect, test } from 'bun:test'
import { Writable } from 'node:stream'
import { requestStartupTerminalSize } from './terminal-size'

function terminal(onWrite?: (text: string) => void) {
  const writes: string[] = []
  const output = Object.assign(new Writable({
    write(chunk, _encoding, done) {
      const text = chunk.toString()
      writes.push(text)
      onWrite?.(text)
      done()
    },
  }), { isTTY: true, columns: 80, rows: 24 })
  return { output, writes }
}

test('startup requests 160 columns and 60 rows once, leaving later user resizes intact', async () => {
  const { output, writes } = terminal(() => {
    // The terminal host, not the application, updates its reported dimensions.
    setImmediate(() => {
      output.columns = 160
      output.rows = 60
      output.emit('resize')
    })
  })
  await requestStartupTerminalSize(output, { TERM: 'xterm-256color' })
  expect(writes).toEqual(['\x1b[8;60;160t'])
  expect(output.listenerCount('resize')).toBe(0)
  output.columns = 100
  output.rows = 30
  // A re-import of the entry during HMR calls the helper again.
  await requestStartupTerminalSize(output, { TERM: 'xterm-256color' })
  expect(writes).toHaveLength(1)
  expect([output.columns, output.rows]).toEqual([100, 30])
})

test('pipes, opted-out users and multiplexed panes receive no resize control sequence', async () => {
  for (const env of [
    { TERM: 'dumb' }, { CI: 'true' }, { TMUX: '/tmp/tmux-0/default,1,0' },
    { STY: '123.screen' }, { GVS_KEEP_TERMINAL_SIZE: '1' },
  ]) {
    const { output, writes } = terminal()
    await requestStartupTerminalSize(output, env)
    expect(writes).toHaveLength(0)
  }
  const { output, writes } = terminal()
  output.isTTY = false
  await requestStartupTerminalSize(output, {})
  expect(writes).toHaveLength(0)
})

test('unsupported hosts time out without reporting a fictional terminal size', async () => {
  const { output, writes } = terminal()
  await requestStartupTerminalSize(output, { TERM: 'xterm-256color' })
  expect(writes).toHaveLength(1)
  expect([output.columns, output.rows]).toEqual([80, 24])
  expect(output.listenerCount('resize')).toBe(0)
})

test('already-sized terminals and rejected writes do not block startup', async () => {
  const { output, writes } = terminal()
  output.columns = 160
  output.rows = 60
  await requestStartupTerminalSize(output, {})
  expect(writes).toHaveLength(0)
  const failed = terminal().output
  failed.write = () => { throw new Error('terminal rejected output') }
  await requestStartupTerminalSize(failed, {})
  expect(failed.listenerCount('resize')).toBe(0)
})
