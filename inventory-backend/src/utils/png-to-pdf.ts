import PDFDocument from "pdfkit";
import sharp from "sharp";

/**
 * Wrap a PNG image into a real, single-page PDF sized exactly to the image.
 * Used to turn the nicely-rendered invoice/voucher PNGs into genuine PDF
 * documents (instead of shipping HTML with a .pdf filename, which opened as a
 * web page on the recipient's phone).
 */
export async function pngToPdf(png: Buffer): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  const width = meta.width ?? 900;
  const height = meta.height ?? 1200;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: [width, height], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.image(png, 0, 0, { width, height });
    doc.end();
  });
}
