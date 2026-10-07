import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adoptIQResume, iqResumeIdentity, iqVideoComplete, markIQVideoComplete } from './iq-resume.ts'
import { resumeScratchDir } from './scratch.ts'

const plan = { rendition: 'rendition-a', key: '01'.repeat(16), playlist: '#EXTM3U\n#EXTINF:4,\nhttps://data.video.iq.com/video.ts?start=0&end=100&contentlength=101&qd_sc=old\n#EXT-X-ENDLIST\n' }

test('IQ resume accepts refreshed signatures but rejects changed bytes, timeline, key or rendition', () => {
  const identity = iqResumeIdentity(plan)
  expect(iqResumeIdentity({ ...plan, playlist: plan.playlist.replace('qd_sc=old', 'qd_sc=new') })).toBe(identity)
  expect(iqResumeIdentity({ ...plan, playlist: plan.playlist.replace('data.video.iq.com', 'akmcdnoversea.inter.iqiyi.com') })).toBe(identity)
  for (const changed of [
    { ...plan, key: '02'.repeat(16) }, { ...plan, rendition: 'rendition-b' },
    { ...plan, playlist: plan.playlist.replace('end=100', 'end=200') },
    { ...plan, playlist: plan.playlist.replace('EXTINF:4', 'EXTINF:5') },
    { ...plan, playlist: plan.playlist.replace('video.ts', 'other.ts') },
  ]) expect(iqResumeIdentity(changed)).not.toBe(identity)
})

test('resume retains complete fragments and never deletes mismatched caches', () => {
  const root = mkdtempSync(join(tmpdir(), 'gvs-iq-resume-'))
  try {
    const first = resumeScratchDir(root, iqResumeIdentity(plan))
    writeFileSync(join(first, '00.ts'), 'completed bytes')
    expect(resumeScratchDir(root, iqResumeIdentity(plan))).toBe(first)
    const second = resumeScratchDir(root, iqResumeIdentity({ ...plan, key: '02'.repeat(16) }))
    expect(second).not.toBe(first)
    expect(readFileSync(join(first, '00.ts'), 'utf8')).toBe('completed bytes')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('legacy adoption checks every key and the saved manifest before admitting fragments', () => {
  const work = mkdtempSync(join(tmpdir(), 'gvs-iq-legacy-'))
  const manifest = join(work, 'iq-video.m3u8'), dir = join(work, 'iq-video', 're-legacy')
  mkdirSync(join(dir, 'download'), { recursive: true })
  const metadata = (key: string) => JSON.stringify([{ Playlist: { MediaParts: [{ MediaSegments: [
    { EncryptInfo: { Method: 'IQ_BBTS', Key: Buffer.from(key, 'hex').toString('base64') } },
  ] }] } }])
  try {
    writeFileSync(manifest, plan.playlist)
    writeFileSync(join(dir, 'download', 'meta_selected.json'), metadata('02'.repeat(16)))
    adoptIQResume(work, manifest, plan)
    expect(existsSync(join(dir, 'resume.json'))).toBe(false)
    writeFileSync(join(dir, 'download', 'meta_selected.json'), metadata(plan.key))
    adoptIQResume(work, manifest, { ...plan, playlist: plan.playlist.replace('end=100', 'end=200') })
    expect(existsSync(join(dir, 'resume.json'))).toBe(false)
    adoptIQResume(work, manifest, plan)
    expect(resumeScratchDir(join(work, 'iq-video'), iqResumeIdentity(plan))).toBe(dir)
    expect(readFileSync(join(dir, 'resume.json'), 'utf8')).not.toContain(plan.key)
    // Pinned identity produced by 0.1.18 for this fixture, before CDN aliases
    // were excluded. Upgrading must keep the already downloaded fragments.
    const legacy = 'a96d4f00894e6d5da916f9907e3559b1b36a2e11e5fd0a4aea225ee973da472d'
    writeFileSync(join(dir, 'resume.json'), JSON.stringify({ version: 1, identity: legacy }))
    const video = join(work, 'iq-video.ts')
    writeFileSync(video, 'complete video')
    markIQVideoComplete(video, legacy)
    const cdnPlan = { ...plan, playlist: plan.playlist.replace('data.video.iq.com', 'akmcdnoversea.inter.iqiyi.com') }
    adoptIQResume(work, manifest, cdnPlan)
    expect(resumeScratchDir(join(work, 'iq-video'), iqResumeIdentity(cdnPlan))).toBe(dir)
    expect(iqVideoComplete(video, iqResumeIdentity(cdnPlan))).toBe(true)
  } finally { rmSync(work, { recursive: true, force: true }) }
})

test('completed video survives a later audio failure only for the same identity and length', () => {
  const work = mkdtempSync(join(tmpdir(), 'gvs-iq-video-')), path = join(work, 'video.ts'), identity = iqResumeIdentity(plan)
  try {
    writeFileSync(path, 'video')
    markIQVideoComplete(path, identity)
    expect(iqVideoComplete(path, identity)).toBe(true)
    expect(iqVideoComplete(path, iqResumeIdentity({ ...plan, key: '02'.repeat(16) }))).toBe(false)
    writeFileSync(path, 'truncated')
    expect(iqVideoComplete(path, identity)).toBe(false)
  } finally { rmSync(work, { recursive: true, force: true }) }
})
