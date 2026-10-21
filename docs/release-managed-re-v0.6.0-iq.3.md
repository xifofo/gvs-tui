# GVS RE 0.6.0-gvs-iq.3

- 读取有长度边界的 SDT service name，重组跨 TS 包的 section，兼容 mdcm 字段顺序变化。
- 支持经参考实现核对的国内 Web 旧式 a0/vector/e1/content 描述。
- 拒绝未知模式、不支持的显式 pattern、残缺 IV 和冲突内容标记，避免误把 provider name 或 CRC 当作加密描述。
- 保留原 sparse AES、CRC 顺序、TS PCR/连续计数器以及临时密钥文件处理方式。

IQ 解密专项 19 项通过；真实加密分片原始和字段重排布局下载/解码通过；海外第8集全视频、国内 Cookie 分片已验证。提供 Windows/macOS/Linux，x64/arm64 六个独立包。Desktop v0.1.65 已内置，无需手工替换。
