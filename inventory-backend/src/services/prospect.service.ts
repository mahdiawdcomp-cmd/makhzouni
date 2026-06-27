import Groq from "groq-sdk";
import { ProspectStatus } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { normalizePhone } from "../utils/phone";

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!process.env.GROQ_API_KEY) throw new AppError("خدمة OCR غير مفعلة", 503, "GROQ_NOT_CONFIGURED");
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

/* ─── List ───────────────────────────────────────────────────────────── */
export async function listProspects(opts?: { status?: ProspectStatus; search?: string }) {
  const where: Record<string, unknown> = {};
  if (opts?.status) where.status = opts.status;
  if (opts?.search) {
    where.OR = [
      { phone: { contains: opts.search } },
      { name: { contains: opts.search, mode: "insensitive" } },
    ];
  }
  const [items, total, newCount, convertedCount] = await Promise.all([
    prisma.prospect.findMany({ where, orderBy: { createdAt: "asc" }, take: 2000 }),
    prisma.prospect.count(),
    prisma.prospect.count({ where: { status: ProspectStatus.NEW } }),
    prisma.prospect.count({ where: { status: ProspectStatus.CONVERTED } }),
  ]);
  return { items, total, newCount, convertedCount };
}

/* ─── Import (paste / vcf / ocr all funnel here) ─────────────────────── */
export interface ProspectEntry {
  phone: string;
  name?: string;
}

export async function importProspects(entries: ProspectEntry[], source = "paste") {
  const seen = new Set<string>();
  const clean: ProspectEntry[] = [];
  for (const e of entries) {
    const phone = normalizePhone(String(e?.phone ?? ""));
    if (!phone || phone.length < 10 || seen.has(phone)) continue;
    seen.add(phone);
    clean.push({ phone, name: e.name?.trim() || undefined });
  }
  if (clean.length === 0) return { added: 0, duplicates: 0, total: 0 };

  // Sequential costmer-NNNN naming continues from the current count.
  let counter = await prisma.prospect.count();
  let added = 0;
  let duplicates = 0;

  for (const entry of clean) {
    const exists = await prisma.prospect.findUnique({ where: { phone: entry.phone }, select: { id: true } });
    if (exists) {
      duplicates++;
      continue;
    }
    counter++;
    const name = entry.name ?? `costmer-${String(counter).padStart(4, "0")}`;
    await prisma.prospect.create({ data: { phone: entry.phone, name, source } });
    added++;
  }
  return { added, duplicates, total: clean.length };
}

/* ─── OCR screenshots → phone numbers ───────────────────────────────── */
// Reuses Groq Vision (same provider as invoice OCR) to read phone numbers out
// of WhatsApp contact-list screenshots, so the owner can self-import monthly.
export async function extractPhonesFromImage(imageBase64: string): Promise<string[]> {
  if (!/^data:image\/(jpeg|jpg|png|webp|gif);base64,/.test(imageBase64)) {
    throw new AppError("صيغة الصورة غير صحيحة", 400, "INVALID_IMAGE");
  }
  const completion = await getGroq().chat.completions.create({
    model: "llama-3.2-11b-vision-preview",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageBase64 } },
          {
            type: "text",
            text: `أنت نظام OCR. هذه صورة فيها قائمة أرقام هواتف.
استخرج كل أرقام الهواتف كما هي بالضبط (مع رمز الدولة إن وجد).
أجب بـ JSON فقط بهذا الشكل: { "phones": ["+9647...", "+9647...", ...] }
- لا تخمّن أرقاماً غير موجودة.
- إذا ما في أرقام: { "phones": [] }`,
          },
        ],
      },
    ],
  });
  try {
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { phones?: string[] };
    return Array.isArray(parsed.phones) ? parsed.phones : [];
  } catch {
    return [];
  }
}

export async function importProspectsFromImages(images: string[]) {
  const allPhones: string[] = [];
  for (const img of images) {
    const phones = await extractPhonesFromImage(img).catch(() => []);
    allPhones.push(...phones);
  }
  return importProspects(allPhones.map((phone) => ({ phone })), "screenshot");
}

/* ─── Convert prospect → real customer ──────────────────────────────── */
export async function convertProspect(id: string, input: { name: string; address?: string }) {
  const prospect = await prisma.prospect.findUnique({ where: { id } });
  if (!prospect) throw new AppError("غير موجود", 404, "PROSPECT_NOT_FOUND");
  if (!input.name?.trim()) throw new AppError("اسم الزبون مطلوب", 400, "NAME_REQUIRED");

  // Reuse an existing customer with the same phone if present, else create one.
  const existing = await prisma.customer.findUnique({ where: { phone: prospect.phone } });
  const customer = existing
    ? await prisma.customer.update({
        where: { id: existing.id },
        data: { name: input.name.trim(), address: input.address?.trim() || existing.address, deletedAt: null },
      })
    : await prisma.customer.create({
        data: {
          name: input.name.trim(),
          phone: prospect.phone,
          address: input.address?.trim() || null,
          openingBalance: 0,
          currentBalance: 0,
        },
      });

  await prisma.prospect.update({
    where: { id },
    data: { status: ProspectStatus.CONVERTED, convertedCustomerId: customer.id, name: input.name.trim() },
  });
  return { customerId: customer.id };
}

export async function deleteProspect(id: string) {
  await prisma.prospect.deleteMany({ where: { id } });
  return { id };
}

export async function clearConvertedProspects() {
  const r = await prisma.prospect.deleteMany({ where: { status: ProspectStatus.CONVERTED } });
  return { deleted: r.count };
}
