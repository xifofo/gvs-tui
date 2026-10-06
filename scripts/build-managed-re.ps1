param([string]$Runtime, [string]$Output, [switch]$Install)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Runtime) {
  if ($IsMacOS) { $Runtime = if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq 'Arm64') { 'osx-arm64' } else { 'osx-x64' } }
  elseif ($IsLinux) { $Runtime = 'linux-x64' }
  else { $Runtime = 'win-x64' }
}
if (-not $Output) { $Output = Join-Path $repoRoot ".build/managed-re/$Runtime" }
$project = Join-Path $repoRoot 'third_party/N_m3u8DL-RE/src/N_m3u8DL-RE/N_m3u8DL-RE.csproj'
& dotnet publish $project -c Release -r $Runtime --self-contained true -p:PublishAot=false -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:Version=0.6.0-gvs-iq.1 -o $Output --nologo
if ($LASTEXITCODE -ne 0) { throw 'Managed RE publish failed' }
Copy-Item -LiteralPath (Join-Path $repoRoot 'third_party/N_m3u8DL-RE/LICENSE') -Destination (Join-Path $Output 'LICENSE.txt') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'third_party/N_m3u8DL-RE/gvs-source.json') -Destination $Output -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'third_party/N_m3u8DL-RE/README-GVS.md') -Destination $Output -Force
$name = if ($Runtime.StartsWith('win-')) { 'N_m3u8DL-RE.exe' } else { 'N_m3u8DL-RE' }
$binary = Join-Path $Output $name
$hostOS = if ($IsMacOS) { 'osx' } elseif ($IsLinux) { 'linux' } else { 'win' }
$hostArch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($Runtime -eq "$hostOS-$hostArch") {
  & $binary --version
  if ($LASTEXITCODE -ne 0) { throw 'Managed RE cannot start' }
} else { Write-Output "Cross-published $Runtime; startup must be checked on that platform" }
if ($Install) {
  if ($Runtime -ne "$hostOS-$hostArch") { throw 'Cannot install a binary for another platform' }
  Copy-Item -LiteralPath $binary -Destination (Join-Path $repoRoot "bin/$name") -Force
  if ($Runtime -eq 'win-x64') {
    $manifestPath = Join-Path $repoRoot 'bin/manifest.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    foreach ($tool in $manifest.tools) {
      if ($tool.name -eq $name) {
        $tool.version = '0.6.0-gvs-iq.1'
        $tool.bytes = (Get-Item -LiteralPath $binary).Length
        $tool.sha256 = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
      }
    }
    $manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding utf8
  }
}
Write-Output "GVS managed RE ready: $binary"
