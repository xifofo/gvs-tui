import { reexecWithoutProxy } from './lib/proxy.ts'
import { requestStartupTerminalSize } from './lib/terminal-size.ts'

await reexecWithoutProxy()
await requestStartupTerminalSize()

// Root/runtime fetch on import. Static import would run before HTTP_PROXY is stripped.
const { createApp } = await import('vue-termui')
const { default: Root } = await import('./Root.vue')

const app = await createApp(Root, null, { exitOnCtrlC: true })
app.mount()
await app.waitUntilExit()
