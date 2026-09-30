# Youku legacy TS download fix

Release versions: TUI `v0.2.14`, desktop `desktop-v0.1.7`.

## Fix

- Add the Youku legacy TS PES processing path before remuxing. The previous MP4/CENC path could return the original TS unchanged despite a successful downloader exit.
- Preserve transport/PES headers, PTS/DTS, packet ordering and incomplete block tails. Work on a separate file; reject invalid keys, discontinuities, truncated input and unsupported payload structure.
- Feed the processed output back into the existing MP4/MKV and decode-validation pipeline. Do not remove the first frame or relax decode checks.
- Do not classify general codec errors as proof of missing membership, expired login or a preview restriction.
- Keep normal CBCS/MP4, clear TS and other providers on their existing paths.

## Verification on 2026-09-30

- 42 focused tests passed across media output, TS processing, download jobs, progress and timing.
- TUI TypeScript, desktop type checks and desktop build passed.
- Existing synthetic CBCS/HLS regression passed through full decode of the final MKV.
- An authorized full-episode download at the originally selected 3840x2160 / 25fps HEVC quality completed, with AAC stereo audio and duration 715.920 seconds.
- Strict full-file audio and video decoding completed with exit status 0 and no decoder errors.

Account credentials, signed media URLs, downloaded media, machine-specific diagnostic scripts and local application backups are not included in the release commit. Cloud CI and platform-specific release artifacts require a separate tag push and workflow verification.
