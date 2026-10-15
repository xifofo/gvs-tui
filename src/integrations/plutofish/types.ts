/** PlutoFish 独立连接契约；公开状态中永远不包含密钥。 */
export type PlutoFishInput = { url: string; key: string }
/** 文件夹浏览只包含名称和字符串 ID，不含网盘凭据。 */
export type PublisherDirectory = { id: string; name: string }
export type PublisherDirectoryPage = {
  sourceAccountId: string
  path: PublisherDirectory[]
  items: PublisherDirectory[]
  nextCursor: string
}
export type PublisherIdentity = {
  id: string
  name: string
  kind: 'publisher' | 'legacy'
  sourceAccount: { id: string; name: string; alias: string } | null
  /** 旧服务端不返回此字段时，桌面端提示刷新或升级并阻止新下载。 */
  categories?: Array<{ value: string; label: string }>
}
export type PlutoFishView = {
  url: string
  hasKey: boolean
  status: 'idle' | 'checking' | 'verified' | 'error'
  error: string
  identity: PublisherIdentity | null
}
