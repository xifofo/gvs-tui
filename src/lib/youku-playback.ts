import { asBool, isObj } from './util.ts'
import type { MediaSpecs } from './actual-version.ts'

export class YoukuPlaybackError extends Error {
  constructor(message: string, readonly errorCode: 'RELOGIN_REQUIRED' | 'YOUKU_PREVIEW_ONLY' | 'YOUKU_INCOMPLETE') {
    super(message)
    this.name = 'YoukuPlaybackError'
  }
}

/** Explicit account expiry and preview flags override stale VIP/profile snapshots. */
export function assertYoukuPlayback(data: Record<string, unknown>): void {
  const session = isObj(data.session) ? data.session : {}
  const summary = isObj(data.summary) ? data.summary : {}
  if (asBool(data.needs_relogin) || asBool(session.needs_relogin) || asBool(summary.needs_relogin)
    || data.logged_in === false || summary.logged_in === false || session.logged_in === false) {
    throw new YoukuPlaybackError('优酷登录状态已失效，请在账号设置中重新扫码登录后重试。', 'RELOGIN_REQUIRED')
  }
  const gate = isObj(data.quality_gate) ? data.quality_gate : {}
  const trial = isObj(data.trial) ? data.trial : {}
  if (asBool(gate.has_trial) || asBool(data.has_trial) || Number(trial.time) > 0) {
    throw new YoukuPlaybackError('优酷当前只返回试看内容，已停止下载；请检查普通优酷、酷喵或帧享对应会员是否过期或未开通。', 'YOUKU_PREVIEW_ONLY')
  }
}

/** A successful mux is insufficient: the actual episode must cover its expected runtime. */
export function assertYoukuDuration(actualSeconds: number | undefined, expectedSeconds = 0): void {
  if (!Number.isFinite(expectedSeconds) || expectedSeconds <= 0) return
  if (!Number.isFinite(actualSeconds) || !actualSeconds || actualSeconds <= 0) {
    throw new YoukuPlaybackError('优酷成品时长无法确认，未标记下载完成，请检查片源后重试。', 'YOUKU_INCOMPLETE')
  }
  if (actualSeconds < expectedSeconds - Math.max(10, expectedSeconds * 0.03)) {
    throw new YoukuPlaybackError(`优酷视频不完整：实际 ${actualSeconds.toFixed(1)} 秒，分集应有 ${expectedSeconds.toFixed(1)} 秒。可能仅取得试看或截断内容，请检查登录及片源权益；未生成成品。`, 'YOUKU_INCOMPLETE')
  }
}

export function assertYoukuCompletedMedia(media: MediaSpecs, expectedSeconds = 0): void {
  assertYoukuDuration(media.durationSeconds, expectedSeconds)
}
