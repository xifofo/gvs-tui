/**
 * MoviePilot 风格的规则组：`4K & Dolby > 1080P & AAC > any`
 * - `>` 分隔优先级档位（越靠前越好），`&` 连接同一档内必须同时满足的条件
 * - 条件前加 `!` 表示取反；`any` 匹配任何版本
 * 纯函数，主进程（订阅自动下载 / 洗版）和界面（规则预览、搜索结果最佳画质）共用。
 */

export type RuleCandidate = {
  index: number
  height: number
  width?: number
  codec: string
  hdr: string
  label?: string
  size?: number
  fps?: number
  audios: RuleAudio[]
}
export type RuleAudio = { id: string; label: string; codec: string; lang?: string }

export type RuleToken = { key: string; neg: boolean }
export type RuleTier = RuleToken[]
export type RuleGroup = { tiers: RuleTier[]; errors: string[] }

export type RuleMatch = {
  /** 命中的档位（0 最好）；-1 表示一档都没命中 */
  tier: number
  index: number
  audioIds: string[]
  label: string
}

export const DEFAULT_RULES = '4K & Dolby > 1080P & Dolby > 1080P > any'

type Pred = { kind: 'video' | 'audio'; test: (c: RuleCandidate, a?: RuleAudio) => boolean }

const norm = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, '')
const isDolbyAudio = (a: RuleAudio) => /dolby|atmos|杜比|全景声|eac3|ec3|ddp|ac3|dd\+|e-?ac-?3/i.test(`${a.codec} ${a.label}`)

const PREDS: Record<string, Pred> = {
  '4k': { kind: 'video', test: (c) => c.height >= 2000 || (c.width ?? 0) >= 3600 },
  '2160p': { kind: 'video', test: (c) => c.height >= 2000 || (c.width ?? 0) >= 3600 },
  '1440p': { kind: 'video', test: (c) => c.height >= 1400 && c.height < 2000 },
  '2k': { kind: 'video', test: (c) => c.height >= 1400 && c.height < 2000 },
  '1080p': { kind: 'video', test: (c) => c.height >= 1000 && c.height < 1400 },
  '720p': { kind: 'video', test: (c) => c.height >= 700 && c.height < 1000 },
  '540p': { kind: 'video', test: (c) => c.height >= 500 && c.height < 700 },
  'hevc': { kind: 'video', test: (c) => /hevc|h\.?265|hvc1|hev1/i.test(c.codec) },
  'h265': { kind: 'video', test: (c) => /hevc|h\.?265|hvc1|hev1/i.test(c.codec) },
  'h264': { kind: 'video', test: (c) => /avc|h\.?264/i.test(c.codec) },
  'avc': { kind: 'video', test: (c) => /avc|h\.?264/i.test(c.codec) },
  'av1': { kind: 'video', test: (c) => /av1|av01/i.test(c.codec) },
  'hdr': { kind: 'video', test: (c) => !!c.hdr && !/^sdr$/i.test(c.hdr) },
  'dv': { kind: 'video', test: (c) => /dolby\s*vision|dovi|(?:^|[^a-z])dv(?:[^a-z]|$)|杜比视界/i.test(`${c.hdr} ${c.label ?? ''} ${c.codec}`) },
  'dolbyvision': { kind: 'video', test: (c) => /dolby\s*vision|dovi|(?:^|[^a-z])dv(?:[^a-z]|$)|杜比视界/i.test(`${c.hdr} ${c.label ?? ''} ${c.codec}`) },
  '60fps': { kind: 'video', test: (c) => (c.fps ?? 0) >= 50 },
  'dolby': { kind: 'audio', test: (_c, a) => !!a && isDolbyAudio(a) },
  'atmos': { kind: 'audio', test: (_c, a) => !!a && /atmos|全景声/i.test(`${a.codec} ${a.label}`) },
  'ddp': { kind: 'audio', test: (_c, a) => !!a && isDolbyAudio(a) },
  'eac3': { kind: 'audio', test: (_c, a) => !!a && isDolbyAudio(a) },
  'dts': { kind: 'audio', test: (_c, a) => !!a && /dts/i.test(`${a.codec} ${a.label}`) },
  'aac': { kind: 'audio', test: (_c, a) => !!a && /aac|mp4a/i.test(`${a.codec} ${a.label}`) },
  'any': { kind: 'video', test: () => true },
}
const ALIASES: Record<string, string> = { '杜比': 'dolby', '杜比视界': 'dv', '全景声': 'atmos', 'uhd': '4k', 'fhd': '1080p', 'hd': '720p', '任意': 'any', '*': 'any', '2160': '2160p', '1080': '1080p', '720': '720p' }

export const RULE_TOKENS = Object.keys(PREDS)

export function parseRules(spec: string): RuleGroup {
  const errors: string[] = []
  const tiers: RuleTier[] = []
  for (const raw of (spec || '').split(/>|＞/)) {
    const part = raw.trim()
    if (!part) continue
    const tier: RuleTier = []
    for (const t of part.split(/&|＆/)) {
      let s = t.trim()
      if (!s) continue
      const neg = s.startsWith('!') || s.startsWith('！')
      if (neg) s = s.slice(1).trim()
      const key = ALIASES[s] ?? ALIASES[norm(s)] ?? norm(s)
      if (!PREDS[key]) { errors.push(`未知条件「${s}」`); continue }
      tier.push({ key, neg })
    }
    if (tier.length) tiers.push(tier)
  }
  return { tiers, errors }
}

export function formatRules(g: RuleGroup): string {
  return g.tiers.map((t) => t.map((x) => (x.neg ? '!' : '') + x.key.toUpperCase().replace('ANY', 'any')).join(' & ')).join(' > ')
}

/** 某个画质 + 音轨组合是否满足一档；返回满足时选中的音轨（无音轨条件时取默认/第一条） */
function tierAudio(tier: RuleTier, c: RuleCandidate): RuleAudio[] | null {
  for (const tok of tier) {
    const p = PREDS[tok.key]!
    if (p.kind === 'video' && p.test(c) === tok.neg) return null
  }
  const audioToks = tier.filter((t) => PREDS[t.key]!.kind === 'audio')
  if (!audioToks.length) return c.audios.slice(0, 1)
  if (!c.audios.length) return audioToks.every((t) => t.neg) ? [] : null
  const ok = c.audios.filter((a) => audioToks.every((t) => PREDS[t.key]!.test(c, a) !== t.neg))
  return ok.length ? ok.slice(0, 1) : null
}

/** 候选按档位 → 分辨率 → 体积排序，取最好的一个 */
export function pickBest(spec: string | RuleGroup, cands: RuleCandidate[]): RuleMatch | null {
  const g = typeof spec === 'string' ? parseRules(spec) : spec
  const tiers = g.tiers.length ? g.tiers : [[{ key: 'any', neg: false }]]
  let best: (RuleMatch & { h: number; s: number }) | null = null
  for (const c of cands) {
    let tier = -1
    let audios: RuleAudio[] = []
    for (let i = 0; i < tiers.length; i++) {
      const a = tierAudio(tiers[i]!, c)
      if (a) { tier = i; audios = a; break }
    }
    if (tier < 0) continue
    const m = { tier, index: c.index, audioIds: audios.map((a) => a.id), label: c.label ?? `${c.height}P`, h: c.height, s: c.size ?? 0 }
    if (!best || m.tier < best.tier || (m.tier === best.tier && (m.h > best.h || (m.h === best.h && m.s > best.s)))) best = m
  }
  if (!best) return null
  const { h: _h, s: _s, ...out } = best
  return out
}

/** 洗版：已下载的档位不是第一档，且新出现的版本档位更好 */
export function shouldUpgrade(currentTier: number, next: RuleMatch | null): boolean {
  if (!next || next.tier < 0) return false
  if (currentTier < 0) return true
  return next.tier < currentTier
}

/** 一句话描述，给列表/搜索结果显示「最佳画质」 */
export function describeCandidate(c: RuleCandidate, audio?: RuleAudio): string {
  const res = c.height >= 2000 ? '2160P' : c.height ? `${c.height}P` : ''
  const codec = /hevc|265/i.test(c.codec) ? 'HEVC' : /av1/i.test(c.codec) ? 'AV1' : /avc|264/i.test(c.codec) ? 'H.264' : c.codec
  return [res, codec, c.hdr && !/^sdr$/i.test(c.hdr) ? c.hdr : '', audio?.label].filter(Boolean).join(' · ')
}
