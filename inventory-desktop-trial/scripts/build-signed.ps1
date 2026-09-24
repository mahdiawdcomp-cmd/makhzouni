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

# The password must reach the build as an EMPTY-BUT-PRESENT variable. In
# PowerShell `$env:X = ""` deletes the variable instead of emptying it, so the
# build found no password, stopped at "expect a prompt for password", and hung
# there until someone noticed — producing an unsigned installer.
# A process-level environment dictionary is the one way to pass an empty value.
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "cmd.exe"
$psi.Arguments = "/c npx tauri build"
$psi.UseShellExecute = $false
$psi.WorkingDirectory = (Get-Location).Path
$psi.EnvironmentVariables["TAURI_SIGNING_PRIVATE_KEY"] = (Resolve-Path $PrivKeyPath).Path
$psi.EnvironmentVariables["TAURI_SIGNING_PRIVATE_KEY_PASSWORD"] = ""

Write-Host "Building signed release..."
$proc = [System.Diagnostics.Process]::Start($psi)
$proc.WaitForExit()
if ($proc.ExitCode -ne 0) {
  Write-Warning "tauri build exited with $($proc.ExitCode)"
}

$bundle = "src-tauri\target\release\bundle\nsis\"
Write-Host ""
Write-Host "Done! Files in: $bundle"
Get-ChildItem $bundle | Select-Object Name

# A build with no .sig cannot be published as an update — say so loudly here
# rather than letting it fail silently on the customer's machine.
if (-not (Get-ChildItem $bundle -Filter '*.sig' -ErrorAction SilentlyContinue)) {
  Write-Warning "NO .sig produced — the updater will reject this build. Check the signing key."
}
