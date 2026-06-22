#!/usr/bin/env bash
# Sync shared source files from inventory-web → inventory-desktop-trial.
# Run this after any change to the web app to keep desktop in parity.
# Files listed in DESKTOP_ONLY are intentionally different and are skipped.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB="$SCRIPT_DIR/../inventory-web/src"
DESK="$SCRIPT_DIR/../inventory-desktop-trial/src"

# These files have legitimate desktop-specific differences — do NOT overwrite.
DESKTOP_ONLY=(
  "main.tsx"                  # wraps app with DesktopTrialGate + imports desktop CSS
  "pwa/usePwaStatus.ts"       # no service-worker in desktop build
  "DesktopTrialGate.tsx"      # desktop-only component
  "desktop-trial.css"         # desktop-only CSS
  "styles.css"                # desktop-only CSS
)

is_desktop_only() {
  local f="$1"
  for skip in "${DESKTOP_ONLY[@]}"; do
    [[ "$f" == "$skip" ]] && return 0
  done
  return 1
}

changed=0
while IFS= read -r -d '' web_file; do
  rel="${web_file#$WEB/}"
  desk_file="$DESK/$rel"

  is_desktop_only "$rel" && continue
  [[ ! -f "$desk_file" ]] && continue   # desktop-only file — skip

  if ! cmp -s "$web_file" "$desk_file"; then
    cp "$web_file" "$desk_file"
    echo "synced: $rel"
    ((changed++)) || true
  fi
done < <(find "$WEB" -type f -name "*.ts" -o -name "*.tsx" -o -name "*.css" | tr '\n' '\0')

echo ""
echo "Done — $changed file(s) updated."
