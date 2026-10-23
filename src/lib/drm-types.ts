/** 用户本人设备文件（网关 /v1/drm/devices）的状态类型；界面与主进程共用。 */
export type DRMSystem = 'widevine' | 'playready'
export const DRM_MAX_BYTES = 1 << 20
/** reupload：网关里保存的是旧格式记录，已不能使用，需要重新上传。 */
export type DRMFileStatus = {
  system: DRMSystem
  configured: boolean
  level?: number
  name?: string
  updatedAt?: string
  reupload?: boolean
  /** 设备池条目 id（聚合视图没有 id）。 */
  id?: string
  /** 同一系统的全部设备，强等级在前。 */
  entries?: DRMFileStatus[]
}
/** Gateway level rule (userdrm.LevelRule); absent fields mean "not required". */
export type DRMLevelRule = { aboveHeight?: number; hdr?: boolean; dolbyVision?: boolean; tiers?: string[]; summary?: string }
/** Per-platform requirement served by newer gateways with GET /v1/drm/devices. */
export type DRMGatewayRequirement = { provider: string; systems: DRMSystem[]; widevineL1?: DRMLevelRule; playReadyMin?: number; playReadyRule?: DRMLevelRule; evidence?: string }
export type DRMStatus = { widevine: DRMFileStatus; playready: DRMFileStatus; requirements?: DRMGatewayRequirement[] }

/** GET /v1/meta/platforms（网关 platformmeta）：每个平台的登录方式、官网、地区与设备文件要求。只读、无密钥。 */
export type PlatformMethod = { id: string; label: string; note?: string }
export type PlatformLevel = { system: DRMSystem; level: string; when?: string }
export type PlatformDevice = { required: boolean; systems?: DRMSystem[]; files?: string[]; levels?: PlatformLevel[]; summary: string; note?: string }
export type PlatformMeta = { provider: string; name: string; methods: PlatformMethod[]; loginUrl?: string; cookieKeys?: string[]; cookieNote?: string; region?: string; description?: string; anonymous: boolean; device: PlatformDevice; unknown?: string[]; audited: boolean; source: 'code' | 'admin'; updatedAt?: string }
export type PlatformMetaResponse = { version: number; platforms: PlatformMeta[] }
