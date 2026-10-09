// Generated from gateway/internal/usermsg/catalog.json; run scripts/sync-user-messages.mjs.
export const errorCatalog = [
  {
    "pattern": "请填写 HTTP/HTTPS 代理地址|代理地址格式",
    "code": "PROXY_INVALID",
    "message": "代理地址格式不正确，请填写 HTTP/HTTPS 代理地址后重试；不使用代理时可留空。"
  },
  {
    "pattern": "IQ_DASH_PROGRAM_MISSING|IQ_DASH_REJECTED|DASH_PROGRAM_MISSING",
    "code": "MEDIA_UNAVAILABLE",
    "message": "视频平台暂未提供可用的播放内容，请稍后重试；若持续失败，请联系客服。"
  },
  {
    "pattern": "requires re-login|needs_relogin|invalid Yk-Sign|RELOGIN_REQUIRED|LOGIN_EXPIRED|SESSION_EXPIRED|IQ_WEB_SESSION_REJECTED",
    "code": "RELOGIN_REQUIRED",
    "message": "平台登录状态已失效，请在账号设置中重新登录后重试。"
  },
  {
    "pattern": "report_binding_(invalid|expired|owner_mismatch|stale_session)|ACCOUNT_BINDING_INVALID",
    "code": "ACCOUNT_BINDING_INVALID",
    "message": "账号连接状态已失效，请重新登录该平台后重试。"
  },
  {
    "pattern": "tui tunnel offline|TUNNEL_OFFLINE|隧道未连接|隧道.*断开",
    "code": "TUNNEL_OFFLINE",
    "message": "本机连接尚未就绪，请保持客户端打开，检查网络后重试。"
  },
  {
    "pattern": "KEY_EXPIRED|api key expired",
    "code": "KEY_EXPIRED",
    "message": "访问密钥已到期，请续费或更换有效密钥。"
  },
  {
    "pattern": "KEY_DISABLED|KEY_REVOKED|KEY_BANNED",
    "code": "KEY_DISABLED",
    "message": "访问密钥已停用，请联系管理员确认。"
  },
  {
    "pattern": "KEY_INVALID|INVALID_API_KEY|MISSING_API_KEY|missing api key|invalid api key|KEY_MISSING|UNAUTHORIZED",
    "code": "KEY_INVALID",
    "message": "访问密钥无效或未填写，请在连接设置中检查密钥。"
  },
  {
    "pattern": "ADMIN_TOKEN_NOT_CONFIGURED",
    "code": "ADMIN_NOT_READY",
    "message": "管理服务尚未配置完成，请联系管理员处理。"
  },
  {
    "pattern": "INVALID_ADMIN_TOKEN",
    "code": "ADMIN_AUTH_REQUIRED",
    "message": "管理凭证无效，请重新登录管理后台。"
  },
  {
    "pattern": "CONCURRENCY_LIMITED",
    "code": "CONCURRENCY_LIMITED",
    "message": "同时进行的任务已达到上限，请等待现有任务完成后再试。"
  },
  {
    "pattern": "DEVICE_REQUIRED|DEVICE_INVALID",
    "code": "DEVICE_INVALID",
    "message": "当前设备未能通过验证，请更新客户端并重新连接；若仍失败，请联系管理员。"
  },
  {
    "pattern": "IP_LIMITED|DEVICE_LIMITED|DEVICE_MISMATCH|DEVICE_BOUND",
    "code": "ACCESS_LIMITED",
    "message": "访问密钥的使用设备或网络受到限制，请停止其他设备的使用，或联系管理员确认。"
  },
  {
    "pattern": "DAILY_LIMIT|QUOTA_EXCEEDED|QUOTA_EXHAUSTED|DAILY_QUOTA|QUOTA_LIMIT|解密次数已用完",
    "code": "QUOTA_EXCEEDED",
    "message": "可用额度已用完，请稍后再试或联系管理员增加额度。"
  },
  {
    "pattern": "RATE_LIMIT|TOO_MANY_REQUESTS|QPS_LIMIT|(?:http|status)[ :_]*429",
    "code": "RATE_LIMITED",
    "message": "操作太频繁，请稍等片刻再试。"
  },
  {
    "pattern": "ROUTE_FORBIDDEN|SCOPE_FORBIDDEN|tunnel route forbidden",
    "code": "ROUTE_FORBIDDEN",
    "message": "当前访问密钥没有此平台的使用权限，请联系管理员开通。"
  },
  {
    "pattern": "REGION_RESTRICTED|REGION_BLOCKED|GEO_BLOCKED|AREA_LIMIT|地域限制|地区限制",
    "code": "REGION_RESTRICTED",
    "message": "平台明确限制了当前地区的访问，暂时无法获取此内容。"
  },
  {
    "pattern": "VIP_REQUIRED|MEMBERSHIP_REQUIRED|PAYMENT_REQUIRED|PAYWALL|需要会员|会员权限不足",
    "code": "MEMBERSHIP_REQUIRED",
    "message": "当前账号没有此内容的观看权限，请确认会员或购买状态后重试。"
  },
  {
    "pattern": "PREVIEW_ONLY|试看内容|仅支持试看",
    "code": "PREVIEW_ONLY",
    "message": "当前账号只能获取试看内容，请确认账号的完整观看权限。"
  },
  {
    "pattern": "RISK_REJECTED|RISK_BLOCK|HARD_BLOCK|限制播放|多地登录|em[=: ]+9[34]|risk_rejected",
    "code": "RISK_REJECTED",
    "message": "平台暂时限制了本次操作，请暂停重试，并在官方客户端检查账号状态。"
  },
  {
    "pattern": "LOGIN_REQUIRED|COOKIE_REQUIRED|VERIFIED_WEB_SESSION_REQUIRED|TV_ACTIVATION_REQUIRED|请先登录",
    "code": "LOGIN_REQUIRED",
    "message": "请先在账号设置中登录该平台，再重试此操作。"
  },
  {
    "pattern": "QR_EXPIRED|QRCODE_EXPIRED|二维码.*过期",
    "code": "QR_EXPIRED",
    "message": "二维码已过期，请刷新二维码后重新扫码。"
  },
  {
    "pattern": "CERTIFICATE_REQUIRED|CERTIFICATE_UNAVAILABLE|IQ_CERTIFICATE_|IQ_DEVICE_KEY_|device certificate|DEVICE_POOL_EMPTY|NO_AVAILABLE_ACCOUNT|NO_AVAILABLE_DEVICE|设备证书",
    "code": "PLATFORM_NOT_READY",
    "message": "该平台的服务暂未准备就绪，请联系客服处理。"
  },
  {
    "pattern": "REQUESTED_QUALITY_UNAVAILABLE|QUALITY_UNAVAILABLE|INVALID_QUALITY",
    "code": "QUALITY_UNAVAILABLE",
    "message": "当前画质暂不可用，请刷新画质列表并选择其他画质。"
  },
  {
    "pattern": "REQUESTED_AUDIO_UNAVAILABLE|INVALID_AUDIO_SELECTION|AUDIO_SEGMENT_UNAVAILABLE",
    "code": "AUDIO_UNAVAILABLE",
    "message": "当前音轨暂不可用，请刷新列表并选择其他音轨。"
  },
  {
    "pattern": "UNSUPPORTED_DRM|UNSUPPORTED_HLS_ENCRYPTION|UNSUPPORTED_VIDEO_CODEC|LICENSE_[A-Z_]+",
    "code": "MEDIA_FORMAT_UNSUPPORTED",
    "message": "暂时无法处理这个视频版本，请尝试其他画质；若仍失败，请联系客服。"
  },
  {
    "pattern": "INCOMPLETE_PLAYLIST|PLAYLIST_[A-Z_]+|SEGMENT_[A-Z_]+|DOWNLOAD_FAILED",
    "code": "DOWNLOAD_FAILED",
    "message": "下载内容不完整或暂不可用，请稍后重新下载。"
  },
  {
    "pattern": "PROVIDER_NOT_FOUND",
    "code": "PROVIDER_NOT_FOUND",
    "message": "当前服务尚未开通此平台，请联系管理员确认。"
  },
  {
    "pattern": "ACTION_UNSUPPORTED|unknown.*action|unsupported.*action|action.*not supported|not implemented|INVALID_CATALOG|action .*see capabilities",
    "code": "ACTION_UNSUPPORTED",
    "message": "当前服务暂不支持此操作，请更新客户端；若仍无法使用，请联系管理员。"
  },
  {
    "pattern": "INVALID_PARAM|INVALID_TVID|INVALID_URL|URL_INVALID|KEYWORD_REQUIRED|ALBUM_ID_REQUIRED|username and password required|verification code required|bad json|invalid login body|POST required",
    "code": "INVALID_PARAM",
    "message": "提交的信息不完整或格式不正确，请检查输入后重试。"
  },
  {
    "pattern": "ENOSPC|disk full|no space left",
    "code": "DISK_FULL",
    "message": "磁盘空间不足，请清理下载目录所在磁盘后重试。"
  },
  {
    "pattern": "EACCES|EPERM|permission denied|目录不可写",
    "code": "FILE_PERMISSION",
    "message": "无法写入所选目录，请在下载设置中更换可写目录后重试。"
  },
  {
    "pattern": "ENOENT|file not found|no such file",
    "code": "FILE_MISSING",
    "message": "所需文件或下载组件不存在，请检查保存目录，或更新客户端后重试。"
  },
  {
    "pattern": "ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|fetch failed|failed to fetch|networkerror|network request failed|dial tcp|network is unreachable",
    "code": "NETWORK_ERROR",
    "message": "暂时无法连接服务，请检查网络和代理设置后重试。"
  },
  {
    "pattern": "timed? ?out|timeout|deadline exceeded|请求超时",
    "code": "TIMEOUT",
    "message": "请求等待超时，请检查网络后重试；若持续超时，请稍后再试。"
  },
  {
    "pattern": "AbortError|operation was aborted|context canceled|cancelled|canceled",
    "code": "CANCELLED",
    "message": "操作已取消，您可以重新发起。"
  },
  {
    "pattern": "JSON_INVALID|SCHEMA_CHANGED|RESPONSE_INVALID|METADATA_MISSING|METADATA_INVALID|EPISODES_MISSING|SyntaxError|unexpected token|unexpected end|invalid character|解析.*失败|上游响应过大|反序列化|接口参数|接口脚本",
    "code": "RESPONSE_INVALID",
    "message": "服务返回的数据暂时无法处理，请稍后重试；若持续失败，请联系客服。"
  },
  {
    "pattern": "UNAVAILABLE|UPSTREAM_HTTP|(?:http|status|github)[ :_]*5[0-9][0-9]|service unavailable|bad gateway",
    "code": "SERVICE_UNAVAILABLE",
    "message": "服务暂时不可用，请稍后重试；若持续失败，请联系客服。"
  },
  {
    "pattern": "(?:http|status)[ :_]*403|FORBIDDEN",
    "code": "REQUEST_REJECTED",
    "message": "本次请求未获允许，请检查账号和使用权限；若原因不明，请联系客服。"
  },
  {
    "pattern": "(?:http|status)[ :_]*404|NOT_FOUND|not found",
    "code": "NOT_FOUND",
    "message": "未找到所需内容，请刷新页面或检查链接后重试。"
  }
] as const
