# Release script — creates GitHub release + latest.json for auto-updater
# Usage: .\scripts\release.ps1 -Version "1.0.1" -Notes "وصف التحديث"
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
  pub_date = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
  platforms = @{
    "windows-x86_64" = @{
      signature = $Signature.Trim()
      url = "https://github.com/mahdiawdcomp-cmd/makhzouni/releases/download/v${Version}/installer.exe"
    }
  }
} | ConvertTo-Json -Depth 5

$LatestJson | Out-File -FilePath "$BundleDir\latest.json" -Encoding utf8
Write-Host "latest.json created."

# Create GitHub release
gh release create "v$Version" `
  "$Installer#installer.exe" `
  "$SigFile#installer.exe.sig" `
  "$BundleDir\latest.json#latest.json" `
  --title "v$Version" `
  --notes $Notes

Write-Host "Release v$Version published on GitHub!"
