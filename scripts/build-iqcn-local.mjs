import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const option = (name, fallback) => process.argv.find(x => x.startsWith(`--${name}=`))?.split('=')[1] || fallback
const platform = option('platform', process.platform)
const arch = option('arch', process.arch)
const goos = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[platform]
const goarch = { x64: 'amd64', arm64: 'arm64' }[arch]
if (!goos || !goarch) throw new Error('Unsupported IQCN helper target')
const output = resolve(root, option('output', `bin/iqcn-local${platform === 'win32' ? '.exe' : ''}`))
mkdirSync(dirname(output), { recursive: true })
const child = spawnSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', output, '.'], {
  cwd: resolve(root, 'tools/iqcn-local'), stdio: 'inherit', windowsHide: true,
  env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' },
})
if (child.error) throw child.error
if (child.status !== 0) process.exit(child.status || 1)
console.log(`Built ${output}`)
