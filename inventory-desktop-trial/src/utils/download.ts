// Reliable cross-platform "open/download a blob URL" helper.
//
// `window.open(blobUrl, "_blank")` is unreliable inside the Tauri desktop
// webview (WebView2 has no real browser-tab concept and frequently no-ops a
// blob: navigation to a new window), which is why printing/downloading
// barcode labels appeared completely broken on desktop. Triggering a
// synthetic <a download> click instead works identically in a normal
// browser tab AND inside Tauri, since it's a native save action, not a
// window-open.
export function downloadBlobUrl(url: string, filename: string) {
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// Best-effort: download the file (always works) and, when running in a
// normal browser tab (not Tauri), also try to open it in a new tab so the
// user sees a print-ready preview immediately. Failure to open is silent —
// the download already succeeded either way.
export function downloadAndPreviewBlobUrl(url: string, filename: string) {
  downloadBlobUrl(url, filename)
  try {
    window.open(url, "_blank", "noopener,noreferrer")
  } catch {
    // ignore — desktop webview commonly can't open a new window for blob:
  }
}
