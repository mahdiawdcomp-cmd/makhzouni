# Build a signed release — run this every time you want to publish an update.
# Usage: .\scripts\build-signed.ps1
#
# Tauri v2 reads TAURI_SIGNING_PRIVATE_KEY (the key itself OR a path to it).
# The old script set TAURI_SIGNING_PRIVATE_KEY_PATH, which is the v1 name — v2
# ignores it, so the build "succeeded" while quietly producing NO signature,
# and every installed app refused the update it was offered.

$PrivKeyPath = "src-tauri\update-key.pem"
if (-not (Test-Path $PrivKeyPath)) {
  Write-Error "Private key not found at $PrivKeyPath"
  exit 1
}

$env:TAURI_SIGNING_PRIVATE_KEY = (Resolve-Path $PrivKeyPath).Path
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""

Write-Host "Building signed release..."
npx tauri build

$bundle = "src-tauri\target\release\bundle\nsis\"
Write-Host ""
Write-Host "Done! Files in: $bundle"
Get-ChildItem $bundle | Select-Object Name

# A build with no .sig cannot be published as an update — say so loudly here
# rather than letting it fail silently on the customer's machine.
if (-not (Get-ChildItem $bundle -Filter '*.sig' -ErrorAction SilentlyContinue)) {
  Write-Warning "NO .sig produced — the updater will reject this build. Check the signing key."
}
