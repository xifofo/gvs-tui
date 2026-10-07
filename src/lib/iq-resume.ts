import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type IQPlan = { playlist: string; key: string; rendition: string }

/** Signed parameters expire; file paths, byte ranges and the timeline identify the media. */
function playlistIdentity(playlist: string): string[] {
  return playlist.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    if (line.startsWith('#')) return line
    const url = new URL(line)
    const params = ['start', 'end', 'contentlength', 'bid', 'br', 'vcodec'].map(name => [name, url.searchParams.get(name)])
    return JSON.stringify([url.host, url.pathname, params])
  })
}

export function iqResumeIdentity(plan: IQPlan): string {
  return createHash('sha256').update(JSON.stringify(['IQ_BBTS', plan.rendition, plan.key.toLowerCase(), playlistIdentity(plan.playlist)])).digest('hex')
}

/** Adopt a pre-fix cache only when its saved manifest AND every stored content key agree. */
export function adoptIQResume(work: string, manifest: string, plan: IQPlan): void {
  if (!plan.key) return
  try {
    const previous = readFileSync(manifest, 'utf8')
    if (JSON.stringify(playlistIdentity(previous)) !== JSON.stringify(playlistIdentity(plan.playlist))) return
    const root = join(work, 'iq-video')
    for (const name of readdirSync(root)) {
      if (!name.startsWith('re-')) continue
      const dir = join(root, name)
      try {
        // Never replace an existing identity from another rendition/key.
        readFileSync(join(dir, 'resume.json'))
        continue
      } catch { /* legacy cache */ }
      try {
        const streams = JSON.parse(readFileSync(join(dir, 'download', 'meta_selected.json'), 'utf8').replace(/^\uFEFF/, ''))
        if (!Array.isArray(streams) || streams.length !== 1) continue
        const parts = streams[0]?.Playlist?.MediaParts
        if (!Array.isArray(parts)) continue
        const segments = parts.flatMap(part => part.MediaSegments ?? [])
        const count = previous.split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#')).length
        if (segments.length !== count || !segments.length) continue
        if (!segments.every(segment => segment.EncryptInfo?.Method === 'IQ_BBTS' &&
          Buffer.from(segment.EncryptInfo.Key ?? '', 'base64').toString('hex') === plan.key.toLowerCase())) continue
        writeFileSync(join(dir, 'resume.json'), JSON.stringify({ version: 1, identity: iqResumeIdentity(plan) }))
      } catch { /* unreadable or unverifiable cache stays intact */ }
    }
  } catch { /* no previous download */ }
}

export function iqVideoComplete(path: string, identity: string): boolean {
  try {
    const state = JSON.parse(readFileSync(`${path}.complete.json`, 'utf8'))
    return state.identity === identity && state.size > 0 && statSync(path).size === state.size
  } catch { return false }
}

export function markIQVideoComplete(path: string, identity: string): void {
  writeFileSync(`${path}.complete.json`, JSON.stringify({ identity, size: statSync(path).size }))
}
