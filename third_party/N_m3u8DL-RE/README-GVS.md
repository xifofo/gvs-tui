# GVS maintained RE

This directory contains the pinned upstream MIT source and the GVS IQ extension.
Source identity is recorded in `gvs-source.json`. The shipping binary is built
from this directory; updates are reviewed and built here rather than replacing
it with an unpatched upstream executable.

```powershell
pwsh scripts/build-managed-re.ps1 -Runtime win-x64 -Install
```

Use .NET SDK 10. The publish output is self-contained and does not require a
user-installed .NET runtime. macOS/Linux use the corresponding runtime ID.

IQ uses `--custom-hls-method IQ_BBTS --custom-hls-key <private-key-file>`.
The client writes a temporary 16-byte key file, removes it on completion or
failure, and keeps the actual content key out of process arguments.
The decoder reads the mdcm IV from each slice, resets counters per NAL, keeps
the encrypted inner CRC until after AES, and preserves TS PCR/continuity.
The initial clear slices are retained unchanged. A source without a current
content key is not decrypted with a sample/default key.

The maintenance workflow publishes six runtime IDs (Windows/macOS/Linux,
x64/arm64) with the license and source identity. Cross-published binaries still
need startup verification on their own platform before release acceptance.
