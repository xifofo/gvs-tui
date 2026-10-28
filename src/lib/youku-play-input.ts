/** 帧享档位的 user_preference 短名（网关 getvideo 12 档）。
 *
 *  网关 v3.9.119 起 UPS 的 max_fps 是硬上限：`profile=full/hdr10/sdr` 都声明 60/120，
 *  只回 `*_hfr_*` 档；25/24 帧母版档（`cmfv5hd4_dolbyvision_hbr_hq` 这类没有 `_hfr_` 的）
 *  必须显式给 `dovi=dv25|hdr10_25|sdr25|imax25` 才会下发。
 *  这里按选中的 stream_type 反推档位名，避免「选了 25 帧那一行、下载却拉成 60 帧」。
 */
function youkuFramePreset(st: string): string {
  const name = st.includes('dolbyvision') ? 'dv'
    : st.includes('imaxenhanced') ? 'imax'
      : st.includes('hdrvivid') || st.includes('vivid') ? 'vivid'
        : /(?:^|_)hdr(?:10)?(?:_|$)/.test(st) ? 'hdr10'
          : /(?:^|_)sdr(?:_|$)/.test(st) ? 'sdr'
            : ''
  if (!name) return ''
  const fps = st.includes('_hfr_') ? '60' : '25'
  return `${name}${name === 'hdr10' ? '_' : ''}${fps}`
}

/** Download from one selected lane/profile so video, DRM and audio share a response. */
export function youkuPlayInput(vid: string, quality = ''): Record<string, string> {
  const input: Record<string, string> = { vid, expand: '0', tier: quality ? 'multi' : 'single', nocache: '1' }
  const [stream = '', source = ''] = quality.split('|')
  const st = stream.toLowerCase()
  const lane = source || (st.startsWith('cmfv') ? 'frame_xiang' : '')
  if (['frame_xiang', 'tv', 'app'].includes(lane)) {
    input.lane = lane
    input.tier = 'single'
    input.lanes = '0'
    if (lane === 'frame_xiang') {
      // These are the gateway's existing named profiles, not a rendition fallback.
      // Its exact returned stream still has to match the user's selection.
      if (st.includes('drm7')) input.profile = 'drm7'
      else if (st.includes('hdrvivid') || st.includes('vivid')) input.profile = 'vivid'
      else if (st.includes('dolbyvision')) { /* full Sony profile defaults to DV */ }
      else if (/(?:^|_)hdr(?:10)?(?:_|$)/.test(st)) input.profile = 'hdr10'
      else if (/(?:^|_)sdr(?:_|$)/.test(st)) input.profile = 'sdr'
      // 帧率档：profile 只管 HDR/SDR 偏好，max_fps 由 dovi 档位名决定。
      const preset = youkuFramePreset(st)
      if (preset) input.dovi = preset
    }
  }
  return input
}
