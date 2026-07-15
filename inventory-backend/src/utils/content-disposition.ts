// HTTP header values must be ASCII (ISO-8859-1). A raw `filename="..."` built
// from product itemNumber or a URL param crashes res.setHeader with
// "Invalid character in header content" as soon as it contains Arabic text.
// Per RFC 6266/5987 we send an ASCII fallback in filename= plus the real
// UTF-8 name in filename*=, which every modern browser prefers.
export function contentDisposition(
  type: "inline" | "attachment",
  filename: string
): string {
  const fallback =
    filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_").trim() ||
    "file";
  const utf8 = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${utf8}`;
}
