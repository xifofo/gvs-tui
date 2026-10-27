import type { JobView } from '@shared/api'

/** 保留未变化任务及分组的响应式身份，进度更新不重建整页历史记录。 */
export function patchJobViews(index: ReadonlyMap<number, JobView>, updates: JobView[]): void {
  for (const update of updates) {
    const current = index.get(update.id)
    // 新增和删除由完整快照处理；过期进度不能把已删除的任务加回来。
    if (!current) continue
    for (const key of Object.keys(current) as Array<keyof JobView>) {
      if (!(key in update)) delete current[key]
    }
    Object.assign(current, update)
  }
}
