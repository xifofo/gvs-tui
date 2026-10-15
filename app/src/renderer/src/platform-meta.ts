import { reactive } from 'vue'
import type { PlatformMeta } from '@shared/api'
import { gvs } from './store'

/**
 * 平台账号说明以网关为准（GET /v1/meta/platforms）。旧网关没有这个接口时只显示
 * 「请更新网关」，不在客户端维护一份重复的平台表。所有文本按纯文本渲染。
 */
const state = reactive<{ list: PlatformMeta[]; status: 'idle' | 'loading' | 'ok' | 'old' | 'error' }>({ list: [], status: 'idle' })
let loading: Promise<void> | null = null

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0009\u000b-\u001f]/g, '').slice(0, max) : '')
const https = (v: unknown) => {
  try { const u = new URL(str(v, 300)); return u.protocol === 'https:' && !u.username && !u.password ? u.href : '' } catch { return '' }
}

function sanitize(raw: unknown): PlatformMeta[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((p): p is PlatformMeta => !!p && typeof p === 'object' && typeof (p as PlatformMeta).provider === 'string').slice(0, 200).map((p) => ({
    ...p,
    name: str(p.name, 40) || p.provider,
    methods: (Array.isArray(p.methods) ? p.methods : []).slice(0, 8).map((m) => ({ id: str(m?.id, 20), label: str(m?.label, 20), note: str(m?.note, 200) || undefined })).filter((m) => m.id && m.label),
    loginUrl: https(p.loginUrl) || undefined,
    cookieKeys: (Array.isArray(p.cookieKeys) ? p.cookieKeys : []).map((k) => str(k, 40)).filter(Boolean).slice(0, 8),
    cookieNote: str(p.cookieNote, 300) || undefined,
    region: str(p.region, 120) || undefined,
    description: str(p.description, 500) || undefined,
    unknown: (Array.isArray(p.unknown) ? p.unknown : []).map((u) => str(u, 120)).filter(Boolean).slice(0, 6),
    device: {
      required: p.device?.required === true,
      files: (Array.isArray(p.device?.files) ? p.device.files : []).map((f) => str(f, 8)).filter(Boolean),
      levels: (Array.isArray(p.device?.levels) ? p.device.levels : []).slice(0, 6).map((l) => ({ system: l?.system === 'playready' ? 'playready' as const : 'widevine' as const, level: str(l?.level, 24), when: str(l?.when, 80) || undefined })),
      summary: str(p.device?.summary, 300),
      note: str(p.device?.note, 300) || undefined,
    },
  }))
}

export function loadPlatformMeta(force = false): Promise<void> {
  if (force) loading = null
  if (state.status === 'idle') state.status = 'loading'
  loading ??= gvs('platformMeta').then((r) => {
    if (!r) { state.list = []; state.status = 'old'; return }
    state.list = sanitize(r.platforms)
    state.status = 'ok'
  }, () => { state.status = 'error'; loading = null })
  return loading
}

export const platformMeta = (provider: string): PlatformMeta | undefined => state.list.find((p) => p.provider === provider)
export const platformMetaStatus = () => state.status
export const platformMetaList = () => state.list

/** 设备文件短标签，供卡片徽标：「.wvd · 默认档需 L1」「无需设备文件」 */
export function deviceBadge(p: PlatformMeta): { text: string; strong: boolean } {
  if (!p.device.required) return { text: '无需设备文件', strong: false }
  const hi = p.device.levels?.find((l) => l.level === 'L1') ?? p.device.levels?.find((l) => /^SL3000$/.test(l.level))
  return { text: `${(p.device.files ?? []).join(' / ')}${hi ? ` · ${hi.when ? hi.when + ' ' : ''}需 ${hi.level}` : ' · L1 / L3 均可'}`, strong: !!hi }
}
