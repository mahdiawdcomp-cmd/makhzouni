import Groq from "groq-sdk";
import { VoucherType } from "@prisma/client";
import prisma from "../config/database";
import { createInvoice } from "../services/invoice.service";
import { createVoucher } from "../services/voucher.service";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsedCommand {
  operation?: "INVOICE" | "VOUCHER";
  customerName?: string;
  productName?: string;
  quantity?: number;
  unit?: "PIECE" | "DOZEN" | "CARTON";
  unitPrice?: number;
  paymentType?: "CASH" | "CREDIT" | "PARTIAL";
  amount?: number;
  voucherType?: "RECEIPT" | "PAYMENT";
  missing?: string[];
}

// ── Main handler ──────────────────────────────────────────────────────────────

function normalizeArabicDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

function extractAmount(command: string) {
  const normalized = normalizeArabicDigits(command).replace(/,/g, "");
  const match = normalized.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function inferVoucherType(command: string) {
  return /دفع|ادفع|دفعت|صرف|سددت لمورد|للمورد/.test(command)
    ? VoucherType.PAYMENT
    : VoucherType.RECEIPT;
}

export const processVoiceCommand = asyncHandler(async (req, res) => {
  const { command } = req.body as { command?: string };

  if (!command || command.trim().length === 0) {
    throw new AppError("الأمر الصوتي فارغ", 400, "EMPTY_COMMAND");
  }

  if (!process.env.GROQ_API_KEY) {
    throw new AppError("GROQ_API_KEY غير مضبوط", 500, "GROQ_NOT_CONFIGURED");
  }

  const rawCommand = command.trim();
  if (/(عدل|هدل|تعديل).*(فاتورة)/.test(rawCommand)) {
    return void res.json({
      clarify: "تعديل الفاتورة يحتاج رقم الفاتورة أو فتح الفاتورة أولاً حتى ما أعدل على فاتورة غلط.",
    });
  }

  const userId = req.user!.id;

  // ── الخطوة 1: Groq يفهم الأمر ────────────────────────────────────────────
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `أنت مساعد لنظام إدارة مخزون عراقي. المستخدم يعطيك أوامر صوتية بالعربي لإنشاء فواتير.

استخرج المعلومات التالية من الأمر وأجب بـ JSON فقط:
{
  "customerName": "اسم الزبون أو المورد (نص)",
  "productName": "اسم المنتج (نص)",
  "quantity": "الكمية (رقم صحيح)",
  "unit": "الوحدة: PIECE للقطعة، DOZEN للدرزن، CARTON للكرتون أو الكارتون",
  "unitPrice": "السعر للوحدة (رقم) — null إذا لم يُذكر",
  "paymentType": "CASH للنقد أو نقداً، CREDIT للدين أو آجل، PARTIAL لجزئي",
  "missing": ["قائمة الحقول الناقصة الضرورية فقط: customerName أو productName أو quantity"]
}

قواعد:
- الوحدة الافتراضية PIECE إذا لم تُذكر
- الدفع الافتراضي CASH إذا لم يُذكر
- missing يحتوي فقط: customerName, productName, quantity — ليس unitPrice
- إذا كل المعلومات موجودة missing يكون []`,
      },
      { role: "user", content: command.trim() },
    ],
  });

  let parsed: ParsedCommand;
  try {
    parsed = JSON.parse(
      completion.choices[0]?.message?.content ?? "{}"
    ) as ParsedCommand;
  } catch {
    throw new AppError("فشل في فهم الأمر — حاول مرة ثانية", 422, "PARSE_ERROR");
  }

  // ── الخطوة 2: معلومات ناقصة؟ اطلب توضيح ─────────────────────────────────
  const commandText = command.trim();
  const operation =
    parsed.operation ??
    (/سند|وصل|قبض|دفع|استلام/.test(commandText) ? "VOUCHER" : "INVOICE");

  if (operation === "VOUCHER") {
    const amount = parsed.amount ?? extractAmount(commandText);
    if (!parsed.customerName || !amount || amount <= 0) {
      const missing = [
        !parsed.customerName ? "اسم الزبون" : null,
        !amount || amount <= 0 ? "المبلغ" : null,
      ].filter(Boolean).join(" و ");
      return void res.json({ clarify: `وضح للسند: ${missing}` });
    }

    const customers = await prisma.customer.findMany({
      where: {
        deletedAt: null,
        name: { contains: parsed.customerName, mode: "insensitive" },
      },
      take: 5,
      orderBy: { name: "asc" },
    });

    if (customers.length === 0) {
      return void res.json({
        clarify: `ما لقيت زبون باسم "${parsed.customerName}"، تأكد من الاسم`,
      });
    }

    const customer = customers[0];
    const type =
      parsed.voucherType === "PAYMENT"
        ? VoucherType.PAYMENT
        : parsed.voucherType === "RECEIPT"
          ? VoucherType.RECEIPT
          : inferVoucherType(commandText);
    const voucher = await createVoucher(
      {
        customerId: customer.id,
        amount,
        type,
        notes: "أنشئ بالأمر الصوتي",
      },
      userId,
    );

    return void res.status(201).json({
      success: true,
      message: `تم إنشاء ${type === VoucherType.PAYMENT ? "سند دفع" : "سند قبض"} رقم ${voucher.voucherNumber} لـ ${customer.name} بمبلغ ${amount.toLocaleString("en-US")} د.ع`,
      voucher: {
        id: voucher.id,
        voucherNumber: voucher.voucherNumber,
        customerName: customer.name,
        amount,
        type,
      },
    });
  }

  if (parsed.missing && parsed.missing.length > 0) {
    const labels: Record<string, string> = {
      customerName: "اسم الزبون",
      productName: "اسم المنتج",
      quantity: "الكمية",
    };
    const missingAr = parsed.missing
      .map((m) => labels[m] ?? m)
      .join(" و ");

    return void res.json({ clarify: `من فضلك وضّح: ${missingAr}` });
  }

  // ── الخطوة 3: ابحث عن الزبون ─────────────────────────────────────────────
  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      name: { contains: parsed.customerName ?? "", mode: "insensitive" },
    },
    take: 5,
    orderBy: { name: "asc" },
  });

  if (customers.length === 0) {
    return void res.json({
      clarify: `ما لقيت زبون باسم "${parsed.customerName}" — تأكد من الاسم`,
    });
  }

  const customer = customers[0];

  // ── الخطوة 4: ابحث عن المنتج ─────────────────────────────────────────────
  const products = await prisma.product.findMany({
    where: {
      deletedAt: null,
      name: { contains: parsed.productName ?? "", mode: "insensitive" },
    },
    take: 5,
    orderBy: { name: "asc" },
  });

  if (products.length === 0) {
    return void res.json({
      clarify: `ما لقيت منتج باسم "${parsed.productName}" — تأكد من الاسم`,
    });
  }

  const product = products[0];

  // ── الخطوة 5: احسب المبلغ المدفوع ────────────────────────────────────────
  const qty = parsed.quantity ?? 1;
  const unit = parsed.unit ?? "PIECE";
  const paymentType = parsed.paymentType ?? "CASH";

  // سعر الوحدة: إما مذكور أو من قاعدة البيانات
  let effectiveUnitPrice = parsed.unitPrice;
  if (!effectiveUnitPrice) {
    const basePrice = Number(product.salePrice ?? 0);
    if (unit === "CARTON") effectiveUnitPrice = basePrice * product.pcsPerCarton;
    else if (unit === "DOZEN") effectiveUnitPrice = basePrice * 12;
    else effectiveUnitPrice = basePrice;
  }

  const totalAmount = effectiveUnitPrice * qty;
  const paidAmount =
    paymentType === "CASH" ? totalAmount :
    paymentType === "PARTIAL" ? totalAmount / 2 :
    0;

  // ── الخطوة 6: أنشئ الفاتورة ──────────────────────────────────────────────
  const invoice = await createInvoice(
    {
      customerId: customer.id,
      type: "SALE",
      discount: 0,
      tax: 0,
      paidAmount,
      paymentType,
      items: [
        {
          productId: product.id,
          unit,
          quantity: qty,
          unitPrice: effectiveUnitPrice,
        },
      ],
    },
    userId
  );

  return void res.status(201).json({
    success: true,
    message: `✅ تم إنشاء الفاتورة رقم ${invoice.invoiceNumber} لـ ${customer.name}`,
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: customer.name,
      productName: product.name,
      quantity: qty,
      unit,
      unitPrice: effectiveUnitPrice,
      totalAmount,
      paymentType,
    },
  });
});
