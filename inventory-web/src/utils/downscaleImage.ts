/**
 * Shrink a picked image to a data URI before it is stored.
 *
 * Catalog images (product photos, gallery shots, banners) live inline in the
 * database rather than on a file host, so an untouched phone photo would be
 * several megabytes in a row that every backup then carries. Downscaling on
 * the client keeps that in check without the shop having to think about it.
 */
export async function downscaleImage(file: File, maxEdge: number, quality: number): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("read failed"))
    reader.readAsDataURL(file)
  })
  const img = new Image()
  img.src = dataUrl
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error("decode failed"))
  })
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext("2d")
  if (!ctx) return ""
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", quality)
}
