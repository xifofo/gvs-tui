/** 合并下载、上传与 ED2K 的刷新；只有队列结构变化才发送完整快照。 */
export class JobUpdateBatch {
  private timer: ReturnType<typeof setTimeout> | undefined
  private full = false
  private readonly ids = new Set<number>()

  constructor(private readonly send: (ids?: number[]) => void, private readonly delay = 120) {}

  schedule(ids?: Iterable<number>): void {
    if (ids === undefined) this.full = true
    else for (const id of ids) this.ids.add(id)
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const changed = this.full ? undefined : [...this.ids]
      this.full = false
      this.ids.clear()
      this.send(changed)
    }, this.delay)
  }

  dispose(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.ids.clear()
    this.full = false
  }
}
