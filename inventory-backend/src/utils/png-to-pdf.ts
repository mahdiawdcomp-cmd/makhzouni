import PDFDocument from "pdfkit";
import sharp from "sharp";

/**
 * Wrap a PNG image into a real, single-page PDF sized exactly to the image.
 * Used to turn the nicely-rendered invoice/voucher PNGs into genuine PDF
 * documents (instead of shipping HTML with a .pdf filename, which opened as a
 * web page on the recipient's phone).
 *
 * `page` overrides the PDF page size, so a PNG rendered at 2x (crisp on a
 * phone) can still be laid out on a page of the real paper dimensions instead
 * of a page twice as large as A4.
 */
export async function pngToPdf(png: Buffer, page?: { width: number; height: number }): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  const width = page?.width ?? meta.width ?? 900;
  const height = page?.height ?? meta.height ?? 1200;

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
