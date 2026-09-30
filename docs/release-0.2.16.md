# TUI v0.2.16 / Desktop v0.1.9

Includes PR #16: responsive layouts, default audio selection, manifest muxing, download progress, episode naming, TMDB matching and gateway proxy routing.

Follow-up fixes retain proxy routing in Tencent job clients, bypass proxies for local gateway tunnels, preserve optional IPC arguments, and repair current-account diagnostics. Desktop observations are sent only when the gateway advertises Electron support; Tencent upstream event automation remains separate.

The single-connection resume tests now hold the initial fixture response open so cancellation cannot race a completed local download. Runtime download behavior is unchanged by that test repair.
