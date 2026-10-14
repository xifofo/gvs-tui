/** 用户本人设备文件（网关 /v1/drm/devices）的状态类型；界面与主进程共用。 */
export type DRMSystem = 'widevine' | 'playready'
export const DRM_MAX_BYTES = 1 << 20
/** reupload：网关里保存的是旧格式记录，已不能使用，需要重新上传。 */
export type DRMFileStatus = { system: DRMSystem; configured: boolean; level?: number; name?: string; updatedAt?: string; reupload?: boolean }
export type DRMStatus = { widevine: DRMFileStatus; playready: DRMFileStatus }
