# Release script — creates GitHub release + latest.json for auto-updater
# Usage: .\scripts\release.ps1 -Version "1.0.1" -Notes "وصف التحديث"
#
# Saved as UTF-8 WITH a BOM on purpose: Windows PowerShell 5.1 reads a BOM-less
# file as ANSI, so the Arabic below broke parsing and the script never ran.
param(
  [string]$Version = "1.0.1",
  [string]$Notes = "تحديث جديد"
)

$BundleDir = "src-tauri\target\release\bundle\nsis"
$Installer = "$BundleDir\مخزوني مهدي عوض_${Version}_x64-setup.exe"
$SigFile   = "$Installer.sig"

if (-not (Test-Path $Installer)) {
  Write-Error "Installer not found: $Installer"
  exit 1
}
if (-not (Test-Path $SigFile)) {
  Write-Error "Signature not found: $SigFile — rebuild with TAURI_SIGNING_PRIVATE_KEY set"
  exit 1
}

$Signature = Get-Content $SigFile -Raw

# Build latest.json
$LatestJson = @{
  version = $Version
  notes   = $Notes
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = @{
    "windows-x86_64" = @{
      signature = $Signature.Trim()
      url = "https://github.com/mahdiawdcomp-cmd/makhzouni/releases/download/v${Version}/installer.exe"
    }
  }
} | ConvertTo-Json -Depth 5

# Upload under the exact names the updater asks for. gh's "file#label" only
# sets a display label — the asset keeps its own file name, and GitHub strips
# the Arabic from it, so the updater's installer.exe / latest.json were 404s.
$Stage = Join-Path $env:TEMP "makhzouni-release-$Version"
Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $Stage | Out-Null
Copy-Item $Installer (Join-Path $Stage "installer.exe")
Copy-Item $SigFile (Join-Path $Stage "installer.exe.sig")
[System.IO.File]::WriteAllText((Join-Path $Stage "latest.json"), $LatestJson, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "latest.json created."

# Create GitHub release
gh release create "v$Version" `
  (Join-Path $Stage "installer.exe") `
  (Join-Path $Stage "installer.exe.sig") `
  (Join-Path $Stage "latest.json") `
  --title "v$Version" `
  --notes $Notes

Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue
Write-Host "Release v$Version published on GitHub!"
