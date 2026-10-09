/** Keep the frame lane's multi-profile catalog available during download. */
export function youkuPlayInput(vid: string, quality = ''): Record<string, string> {
  const input: Record<string, string> = { vid, expand: '0', tier: quality ? 'multi' : 'single', nocache: '1' }
  const lane = quality.split('|')[1]
  // TV/App each return their ladder in one request. Frame HDR10/SDR/DRM7
  // choices come from separate profiles; lane=frame_xiang would fetch only DV.
  // The response selector still requires the exact stream and source.
  if (lane === 'tv' || lane === 'app') {
    input.lane = lane
    input.tier = 'single'
    input.lanes = '0'
  }
  return input
}
