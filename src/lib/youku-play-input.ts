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
    }
  }
  return input
}
