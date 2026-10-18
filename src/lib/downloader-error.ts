/** A known media-format incompatibility cannot be fixed by refreshing CDN URLs. */
export class DownloaderCompatibilityError extends Error {
  readonly errorCode = 'DOWNLOADER_UNSUPPORTED_MEDIA'
  constructor(diagnostics: string) {
    super(`N_m3u8DL-RE 不支持当前视频分片格式：${diagnostics}`)
    this.name = 'DownloaderCompatibilityError'
  }
}

/** Match an explicit component error, never infer incompatibility from HTTP failures. */
export function hasUnsupportedDownloaderFormat(diagnostics: string): boolean {
  return /Unsupported IQ mdcm encryption pattern/i.test(diagnostics)
}
