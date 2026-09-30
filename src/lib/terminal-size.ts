export const DEFAULT_TERMINAL_SIZE = { columns: 160, rows: 60 } as const

// Keep the guard across Vite full reloads; a reload must not undo a user's resize.
const requestKey = Symbol.for('gvs.startup-terminal-size')
type TerminalOutput = {
  isTTY?: boolean
  columns?: number
  rows?: number
  write: (text: string, callback: (error?: Error | null) => void) => unknown
  on: (event: 'resize', listener: () => void) => unknown
  removeListener: (event: 'resize', listener: () => void) => unknown
  [requestKey]?: boolean
}

/** Ask the host terminal to resize once. Rendering still uses its actual size.
 * XTWINOPS: CSI 8 ; rows ; columns t. Unsupported hosts may ignore it.
 * https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
 */
export async function requestStartupTerminalSize(
  output: TerminalOutput = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (output[requestKey]) return
  output[requestKey] = true
  // Pipes and multiplexed panes have no independent window to resize.
  if (!output.isTTY || env.TERM === 'dumb' || env.CI || env.TMUX || env.STY || env.GVS_KEEP_TERMINAL_SIZE === '1') return
  const { columns, rows } = DEFAULT_TERMINAL_SIZE
  if (output.columns === columns && output.rows === rows) return

  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      output.removeListener('resize', finish)
      resolve()
    }
    // Bound startup even if the terminal refuses or limits the requested size.
    const timer = setTimeout(finish, 250)
    output.on('resize', finish)
    try {
      output.write(`\x1b[8;${rows};${columns}t`, (error) => {
        if (error) finish()
      })
    } catch {
      finish()
    }
  })
}
