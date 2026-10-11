import type { UpdateState } from '../shared/api'
import { RELEASES_URL } from './updater-release'

/** A failed background check must not discard an already discovered update. */
export function failedCheckState(before: UpdateState, current: UpdateState, manual: boolean, message: string, url: string): UpdateState {
  if (current.status === 'ready' || current.status === 'downloading') return { ...current }
  if (before.status === 'available') return { ...before, message: manual ? message : before.message }
  if (!manual) return { ...before }
  return { ...before, status: 'error', message, url: url || RELEASES_URL }
}

export function downloadFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/sha512|checksum|digest|signature|签名|校验/i.test(raw)) return '更新包完整性校验失败，未安装。请稍后重试或打开官方发布页。'
  if (/\b403\b|\b429\b/.test(raw)) return 'GitHub 暂时限制更新包下载，请稍后重试或打开官方发布页。'
  return '更新包暂时无法下载，请检查网络或系统代理，或打开官方发布页。'
}
