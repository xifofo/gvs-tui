# Desktop 0.1.14

发现页此前排除了 IQ，导致有 IQ 权限的用户也看不到榜单入口。现在 IQ 与其它平台一起显示，读取网关的官方榜单栏目，并支持从榜单进入详情、选集和下载。

Windows、Intel Mac 和 Apple Silicon Mac 安装包都包含对应架构的维护版 RE。用户无需自行构建；RE 的媒体解密处理在客户端可见，私有 Gateway 的取流、登录签名和 K 推导代码不在桌面包中。

`IQ_CERTIFICATE_REQUIRED` 是 Gateway 缺少授权证书配置，不能通过升级桌面包解决。管理员应按 Gateway 的 IQ API 文档配置服务端 `iq.certificatePath`，重启服务后用户重新登录。

验证：桌面 Vue/TypeScript 检查和生产构建；使用本机桌面配置验证线上 IQ 登录状态、榜单目录、榜单内容及原报错单集的探测响应。线上证书未配置时取流仍会失败。
