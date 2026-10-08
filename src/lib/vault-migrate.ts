import type { FileConfig } from './config.ts'
import type { GwClient } from './client.ts'
import { runLog } from './runlog.ts'

/**
 * 瘦客户端一次性迁移：把本地保存的源站凭证推给网关托管（网关侧加密落盘），
 * 成功后从 tui.json 清空。网关不在线 → 字段保留，下次启动重试；
 * 失败或未确认持久化 → 保留原字段，下一次连接重试。
 * tui.json 从此只保留网关 key 与非敏感配置。
 */

export type VaultMigrationResult = {
  migrated: string[]
  clearedDead: string[]
  kept: string[]
}

export type CredentialKind = 'tencent' | 'douyin' | 'iq'

/** A successful HTTP envelope alone does not prove a durable import. */
export async function pushLocalCredential(cli: Pick<GwClient, 'invoke'>, kind: CredentialKind, value: string): Promise<void> {
  if (!value.trim()) throw new Error('凭证不能为空')
  const reply = kind === 'tencent'
    ? await cli.invoke(kind, 'login', { method: 'cookie', cookie: value.trim() })
    : await cli.invoke(kind, 'login', { op: 'import', cookie: value.trim() })
  if (kind === 'tencent' ? reply.logged_in !== true : reply.imported !== true || reply.persisted !== true)
    throw new Error('网关未确认凭证已保存，原本地凭证保留')
}

export async function migrateLocalCredentials(
  cli: Pick<GwClient, 'invoke'>,
  cfg: FileConfig,
): Promise<VaultMigrationResult> {
  const migrated: string[] = []
  const clearedDead: string[] = []
  const kept: string[] = []
  const store = cfg as unknown as Record<string, unknown>

  const attempt = async (field: string, push: () => Promise<unknown>): Promise<void> => {
    const value = store[field]
    if (typeof value !== 'string' || !value.trim()) return
    try {
      await push()
      if (store[field] !== value) { kept.push(field); return }
      migrated.push(field)
      store[field] = ''
      runLog(`vault_migrate ${field} pushed to gateway`)
    } catch (error) {
      // Old gateways, wrong API keys and storage errors can also say invalid/not found.
      kept.push(field)
      runLog(`vault_migrate ${field} kept; import not confirmed`)
    }
  }

  await attempt('tencentCookie', () =>
    pushLocalCredential(cli, 'tencent', cfg.tencentCookie))
  await attempt('youkuSign', async () => {
    const reply = await cli.invoke('youku', 'cred', { method: 'bind' }, { 'Yk-Sign': cfg.youkuSign })
    if (reply.bound !== true) throw new Error('网关未确认优酷凭证已绑定')
  })
  await attempt('douyinCookie', () =>
    pushLocalCredential(cli, 'douyin', cfg.douyinCookie || ''))
  await attempt('iqCookie', () =>
    pushLocalCredential(cli, 'iq', cfg.iqCookie || ''))

  return { migrated, clearedDead, kept }
}

export function hasLocalCredentials(cfg: FileConfig): boolean {
  const store = cfg as unknown as Record<string, unknown>
  return ['tencentCookie', 'youkuSign', 'douyinCookie', 'iqCookie'].some(
    (k) => typeof store[k] === 'string' && (store[k] as string).trim() !== '',
  )
}
