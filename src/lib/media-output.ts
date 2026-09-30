import { closeSync, openSync, readSync } from 'node:fs'

/** This path expects MP4 CENC output; a TS sync header is not proof of plaintext. */
export function isMpegTsFile(path: string): boolean {
  const fd = openSync(path, 'r')
  try {
    const header = Buffer.alloc(188 * 5)
    const size = readSync(fd, header, 0, header.length, 0)
    return size >= header.length && [0,188,376,564,752].every(i => header[i] === 0x47)
  } finally { closeSync(fd) }
}

export function assertCencMp4Output(path: string, expectedCenc: boolean): void {
  if (expectedCenc && isMpegTsFile(path)) throw new Error('加密格式与处理路径不匹配：当前 CENC/MP4 路径输出为 MPEG-TS，未验证解密成功。已停止封装并保留诊断文件；不能据此判定为未登录或非会员。')
}

/** Codec errors cannot establish account entitlement or a preview restriction. */
export function youkuMediaError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error)
  if (!/channel element|Prediction is not allowed|is not allocated|Error submitting packet/i.test(message)) return error
  return new Error('音视频解码失败，未生成成品。请检查片源完整性及格式处理；此错误不能判定为未登录、非会员或超出试看。', { cause: error })
}
