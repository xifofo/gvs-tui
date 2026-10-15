/** 分类使用当前发布端提供的启用选项；空选项和失效值均不能提交。 */
import type { PlutoFishView } from './types.ts'

export function publicationCategoryError(connection: PlutoFishView | undefined, category: string): string {
  if (connection?.status !== 'verified') return '请先连接 PlutoFish，再获取资源分类'
  const categories = connection.identity?.categories
  if (categories === undefined) return '当前服务未返回资源分类，请刷新；若仍无结果，请更新 PlutoFish 服务'
  if (!categories.length) return '暂无可用资源分类，请在 PlutoFish 后台启用分类后刷新'
  if (!category) return '请选择资源分类'
  if (!categories.some(c => c.value === category)) return '所选资源分类已不可用，请重新选择'
  return ''
}
