export function tencentCaption(value: string): string {
  const c = value.trim().toLowerCase()
  if (['soft', '软', '软字幕', 'srt'].includes(c)) return 'soft'
  if (['hard', '硬', '硬字幕', 'burn'].includes(c)) return 'hard'
  return c
}
