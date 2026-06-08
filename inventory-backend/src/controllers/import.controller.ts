import { read, utils } from "xlsx";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { asyncHandler } from "../utils/async-handler";

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function cleanNum(v: unknown): number {
  const n = Number(String(v ?? "0").replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

// POST /api/import/products  — expects multipart with field "file" (.xlsx or .csv)
export const importProducts = asyncHandler(async (req, res) => {
  const file = (req as unknown as { file?: { buffer: Buffer } }).file;
  if (!file) throw new AppError("لم يتم رفع أي ملف", 400, "NO_FILE");

  const wb = read(file.buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  if (rows.length === 0) throw new AppError("الملف فارغ", 400, "EMPTY_FILE");
  if (rows.length > 5000) throw new AppError("الملف يحتوي على أكثر من 5000 صف", 400, "TOO_MANY_ROWS");

  // Get next item number counter
  const counterKey = "item-number";
  const counter = await prisma.counter.upsert({
    where: { key: counterKey },
    update: {},
    create: { key: counterKey, value: 0 },
  });
  let nextNum = counter.value;

  const results = { created: 0, skipped: 0, errors: [] as string[] };

  for (const row of rows) {
    try {
      const name = clean(row["اسم المادة"] ?? row["name"] ?? row["Name"] ?? row["المادة"]);
      if (!name) { results.skipped++; continue; }

      const salePrice = cleanNum(row["سعر البيع"] ?? row["salePrice"] ?? row["sale_price"] ?? 0);
      const costPrice = cleanNum(row["سعر الكلفة"] ?? row["costPrice"] ?? row["cost_price"] ?? 0);
      const purchasePrice = cleanNum(row["سعر الشراء"] ?? row["purchasePrice"] ?? row["purchase_price"] ?? 0);
      const pcsPerCarton = Math.max(1, cleanNum(row["قطع بالكارتون"] ?? row["pcsPerCarton"] ?? row["pcs_per_carton"] ?? 1));
      const cartonsAvailable = cleanNum(row["كراتين متوفرة"] ?? row["cartonsAvailable"] ?? row["cartons"] ?? 0);
      const openingBalancePcs = cleanNum(row["قطع افتتاحية"] ?? row["openingPcs"] ?? row["pcs"] ?? 0);
      const category = clean(row["الفئة"] ?? row["category"] ?? row["Category"] ?? "");
      const storageLocation = clean(row["موقع التخزين"] ?? row["location"] ?? "");

      // Use provided itemNumber or auto-generate
      let itemNumber = clean(row["رقم المادة"] ?? row["itemNumber"] ?? row["item_number"] ?? "");
      if (!itemNumber) {
        nextNum++;
        itemNumber = `P${String(nextNum).padStart(5, "0")}`;
      }

      // Check if itemNumber already exists
      const existing = await prisma.product.findUnique({ where: { itemNumber } });
      if (existing) { results.skipped++; continue; }

      const qrCode = `QR-${itemNumber}`;
      const existingQr = await prisma.product.findUnique({ where: { qrCode } });
      if (existingQr) { results.skipped++; continue; }

      // Get first ADMIN user as creator
      const creator = await prisma.user.findFirst({ where: { isActive: true }, orderBy: { role: "asc" } });
      if (!creator) throw new Error("لا يوجد مستخدم نشط");

      await prisma.product.create({
        data: {
          itemNumber,
          name,
          qrCode,
          salePrice,
          costPrice,
          purchasePrice,
          pcsPerCarton,
          cartonsAvailable: Math.floor(cartonsAvailable),
          openingBalancePcs: Math.floor(openingBalancePcs),
          category: category || null,
          storageLocation: storageLocation || null,
          createdBy: creator.id,
        },
      });

      results.created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push(`صف ${rows.indexOf(row) + 2}: ${msg}`);
    }
  }

  // Update counter
  await prisma.counter.update({
    where: { key: counterKey },
    data: { value: nextNum },
  });

  res.json({ success: true, data: results });
});

// GET /api/import/products/template — returns Excel template
export const downloadTemplate = asyncHandler(async (_req, res) => {
  const ws = utils.aoa_to_sheet([
    ["اسم المادة", "رقم المادة", "الفئة", "سعر البيع", "سعر الكلفة", "سعر الشراء", "قطع بالكارتون", "كراتين متوفرة", "قطع افتتاحية", "موقع التخزين"],
    ["مثال: شامبو", "P00001", "عناية شخصية", "5000", "3000", "3500", "12", "10", "5", "رف أ"],
  ]);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "منتجات");

  const { write } = await import("xlsx");
  const buf = write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=products-template.xlsx");
  res.send(buf);
});
