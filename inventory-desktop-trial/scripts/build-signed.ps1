# Build a signed release — run this every time you want to publish an update
# Usage: .\scripts\build-signed.ps1

$PrivKeyPath = "src-tauri\update-key.pem"
if (-not (Test-Path $PrivKeyPath)) {
  Write-Error "Private key not found at $PrivKeyPath"
  exit 1
}

$env:TAURI_SIGNING_PRIVATE_KEY_PATH = Resolve-Path $PrivKeyPath
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""

Write-Host "Building signed release..."
npx tauri build

Write-Host ""
Write-Host "Done! Files in: src-tauri\target\release\bundle\nsis\"
Get-ChildItem "src-tauri\target\release\bundle\nsis\" | Select-Object Name
