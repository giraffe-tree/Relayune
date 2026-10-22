param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerDirectory,

  [string]$ExpectedVersion,

  [switch]$ExpectUnsigned
)

$ErrorActionPreference = "Stop"

$tauriConfigPath = Join-Path $PSScriptRoot "..\src-tauri\tauri.conf.json"
$tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$expectedProductName = [string]$tauriConfig.productName
if ([string]::IsNullOrWhiteSpace($expectedProductName)) {
  throw "Tauri productName is required for Windows installer verification."
}
if ([string]::IsNullOrWhiteSpace($ExpectedVersion)) {
  $ExpectedVersion = [string]$tauriConfig.version
}
if ([string]::IsNullOrWhiteSpace($ExpectedVersion)) {
  throw "ExpectedVersion is required for Windows installer verification."
}

$installers = @(Get-ChildItem -LiteralPath $InstallerDirectory -Filter "*.exe" -File)
if ($installers.Count -ne 1) {
  throw "Expected exactly one NSIS installer in $InstallerDirectory, found $($installers.Count)."
}

$installer = $installers[0]
if ($installer.Length -lt 1MB) {
  throw "NSIS installer is unexpectedly small: $($installer.Length) bytes."
}

$stream = [System.IO.File]::OpenRead($installer.FullName)
try {
  $first = $stream.ReadByte()
  $second = $stream.ReadByte()
} finally {
  $stream.Dispose()
}
if ($first -ne 0x4D -or $second -ne 0x5A) {
  throw "NSIS installer does not have a Windows PE MZ header."
}

$versionInfo = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($installer.FullName)
if ($versionInfo.ProductName -ne $expectedProductName) {
  throw "Windows installer ProductName '$($versionInfo.ProductName)' does not match '$expectedProductName'."
}
if ($versionInfo.ProductVersion -ne $ExpectedVersion) {
  throw "Windows installer ProductVersion '$($versionInfo.ProductVersion)' does not match '$ExpectedVersion'."
}

$signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
if ($ExpectUnsigned -and $signature.Status -ne "NotSigned") {
  throw "Unsigned CI installer unexpectedly has signature status $($signature.Status)."
}
if (-not $ExpectUnsigned -and $signature.Status -notin @("Valid", "NotSigned")) {
  throw "Windows installer has unacceptable signature status $($signature.Status)."
}

$digest = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$manifestPath = "$($installer.FullName).sha256"
Set-Content -LiteralPath $manifestPath -Value "$digest  $($installer.Name)" -Encoding ascii -NoNewline

Write-Host "Verified Windows NSIS installer: $($installer.Name)"
Write-Host "SHA-256: $digest"
