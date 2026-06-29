import { invoke } from "@tauri-apps/api/core"

// True when running inside the Tauri desktop webview.
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

// Reliable cross-platform "open/download a blob URL" helper for the WEB build.
//
// `window.open(blobUrl, "_blank")` is unreliable inside the Tauri desktop
// webview, and even a synthetic <a download> click does nothing there — so
// desktop uses openExternalUrl() instead (see deliverLabel below). In a
// normal browser tab the <a download> click works perfectly.
export function downloadBlobUrl(url: string, filename: string) {
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function downloadAndPreviewBlobUrl(url: string, filename: string) {
  downloadBlobUrl(url, filename)
  try {
    window.open(url, "_blank", "noopener,noreferrer")
  } catch {
    // ignore — desktop webview commonly can't open a new window for blob:
  }
}

// Open an absolute URL in the OS default browser/app via the Rust shell.
// Used on desktop where in-webview download/preview is a no-op.
export async function openExternalUrl(url: string) {
  await invoke("open_external", { url })
}

// Deliver a label (print or download): on desktop, open the public absolute
// URL in the system browser (reliable, shows correct Arabic, user can
// print/save from there); on web, download the fetched blob with a proper
// filename (and best-effort preview).
export async function deliverLabel(
  absoluteUrl: string,
  blobUrl: () => Promise<string>,
  filename: string,
) {
  if (isTauri()) {
    await openExternalUrl(absoluteUrl)
    return
  }
  downloadAndPreviewBlobUrl(await blobUrl(), filename)
}
