import Groq from "groq-sdk";
import { PaymentType, Unit, VoucherType } from "@prisma/client";
import prisma from "../config/database";
import { createInvoice } from "../services/invoice.service";
import { createVoucher } from "../services/voucher.service";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

type ChatMessage = { role: "user" | "assistant"; content: string };

export interface VoicePlanItem {
  productId: string;
  productName: string;
  quantity: number;
  unit: Unit;
  unitPrice: number;
  totalPrice: number;
}

export interface VoicePlan {
  operation: "INVOICE" | "VOUCHER";
  customerId: string;
  customerName: string;
  items?: VoicePlanItem[];
  totalAmount?: number;
  paymentType?: PaymentType;
  paidAmount?: number;
  amount?: number;
  voucherType?: VoucherType;
}

type ParsedIntent = {
  type: "INVOICE" | "VOUCHER" | "QUESTION" | "OUT_OF_SCOPE";
  customerName?: string | null;
  items?: Array<{
    productName?: string | null;
    quantity?: number | null;
    unit?: Unit | null;
    unitPrice?: number | null;
  }>;
  paymentType?: PaymentType | null;
  paidAmount?: number | null;
  amount?: number | null;
  voucherType?: VoucherType | null;
  missing?: string[];
};

export function normalizeIraqiText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ـ/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function levenshtein(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, index) => index);
  for (let j = 1; j <= b.length; j += 1) {
    let previous = rows[0];
    rows[0] = j;
    for (let i = 1; i <= a.length; i += 1) {
      const current = rows[i];
      rows[i] = Math.min(
        rows[i] + 1,
        rows[i - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      previous = current;
    }
  }
  return rows[a.length];
}

export function matchScore(query: string, candidate: string) {
  const q = normalizeIraqiText(query);
  const c = normalizeIraqiText(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.includes(q) || q.includes(c)) return 0.92;
  const distance = levenshtein(q, c);
  return Math.max(0, 1 - distance / Math.max(q.length, c.length));
}

function bestMatches<T extends { name: string }>(query: string, rows: T[]) {
  return rows
    .map((row) => ({ row, score: matchScore(query, row.name) }))
    .filter((entry) => entry.score >= 0.48)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function chooseMatch<T extends { name: string }>(query: string, rows: T[]) {
  const matches = bestMatches(query, rows);
  if (!matches.length) return { match: null, suggestions: [] as string[] };
  const first = matches[0];
  const second = matches[1];
  const isCertain = first.score >= 0.78 && (!second || first.score - second.score >= 0.08);
  return {
    match: isCertain ? first.row : null,
    suggestions: matches.map((entry) => entry.row.name),
  };
}

function parseJson(content: string | null | undefined): ParsedIntent {
  try {
    return JSON.parse(content ?? "{}") as ParsedIntent;
  } catch {
    throw new AppError("ما قدرت أفهم الطلب، حاول تصيغه بطريقة ثانية", 422, "PARSE_ERROR");
  }
}

const domainSystemPrompt = `أنت مساعد نظام مخزون ومحاسبة عراقي. تفهم اللهجة العراقية العامة، لكن مجال كلامك محصور حصراً بعمل النظام: المواد، المخزون، المخازن، الزبائن، الموردين، الفواتير، السندات، المرتجعات، عروض الأسعار، التقارير، الكتالوج والمستخدمين.

صنف آخر رسالة وأرجع JSON فقط بهذا الشكل:
{
  "type": "INVOICE" | "VOUCHER" | "QUESTION" | "OUT_OF_SCOPE",
  "customerName": "الاسم أو null",
  "items": [{"productName":"الاسم", "quantity":1, "unit":"PIECE|DOZEN|CARTON", "unitPrice":null}],
  "paymentType": "CASH|CREDIT|PARTIAL|null",
  "paidAmount": null,
  "amount": null,
  "voucherType": "RECEIPT|PAYMENT|null",
  "missing": []
}

قواعد مهمة:
- افهم الرسالة الحالية مع الرسائل السابقة كطلب واحد مستمر. إذا سألت المستخدم عن معلومة ناقصة وجاوب بكلمة أو جملة قصيرة، أكمل نفس العملية ولا تعتبر جوابه سؤالاً جديداً.
- افهم الأمر حتى بدون كلمة فاتورة. مثال: "سجل كارتون طياره على عباس نقد" = INVOICE، عباس زبون، طياره مادة، الكمية 1، الوحدة CARTON، والدفع CASH.
- "على عباس" أو "لعباس" غالباً اسم الزبون. لا تعتبر كلمة نقد أو آجل جزءاً من الاسم.
- كارتون/كارتونة/كارتونة وحدة CARTON، درزن/دزينة DOZEN، حبة/قطعة PIECE.
- نقد/كاش/واصل كامل = CASH. آجل/دين/بالحساب = CREDIT. واصل جزء أو دفع جزء = PARTIAL واستخرج paidAmount.
- سند قبض يعني RECEIPT، وسند دفع يعني PAYMENT.
- إذا ذكر أكثر من مادة ضعها كلها في items.
- QUESTION فقط لسؤال يخص النظام أو التجارة الموجودة داخله.
- أي سياسة، طب، برمجة عامة، طقس، رياضة، أخبار، دردشة عامة أو موضوع خارج النظام = OUT_OF_SCOPE.
- لا تخترع أسماء أو أرقام. ضع الحقول الناقصة فعلاً في missing.`;

export const parseVoiceCommand = asyncHandler(async (req, res) => {
  const { command, history = [] } = req.body as {
    command?: string;
    history?: ChatMessage[];
  };
  if (!command?.trim()) throw new AppError("اكتب أو احچي طلبك أولاً", 400, "EMPTY_COMMAND");
  if (!process.env.GROQ_API_KEY) {
    throw new AppError("خدمة المساعد غير مفعلة على السيرفر", 500, "GROQ_NOT_CONFIGURED");
  }

  const safeHistory = history
    .filter((message) => message?.content?.trim())
    .slice(-8)
    .map((message) => ({ role: message.role, content: message.content.slice(0, 600) }));

  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: domainSystemPrompt },
      ...safeHistory,
      { role: "user", content: command.trim() },
    ],
  });
  const parsed = parseJson(completion.choices[0]?.message?.content);

  if (parsed.type === "OUT_OF_SCOPE") {
    return void res.json({
      type: "answer",
      text: "هذا الموضوع خارج شغل البرنامج. أگدر أساعدك بالمخزون، الفواتير، الحسابات، الزبائن والتقارير.",
    });
  }

  if (parsed.type === "QUESTION") {
    const answer = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.25,
      messages: [
        {
          role: "system",
          content: "جاوب باختصار وباللهجة العراقية عن استخدام نظام المخزون والمحاسبة فقط. إذا السؤال خارج النظام ارفضه بجملة واحدة. لا تخترع بيانات فعلية غير متاحة إلك.",
        },
        ...safeHistory,
        { role: "user", content: command.trim() },
      ],
    });
    return void res.json({
      type: "answer",
      text: answer.choices[0]?.message?.content?.trim() || "وضح سؤالك عن البرنامج أكثر.",
    });
  }

  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 5000,
  });

  if (!parsed.customerName) {
    return void res.json({ type: "clarify", question: "على اسم منو أسجلها؟" });
  }
  const customerResult = chooseMatch(parsed.customerName, customers);
  if (!customerResult.match) {
    const suffix = customerResult.suggestions.length
      ? ` تقصد: ${customerResult.suggestions.join("، ")}؟`
      : "";
    return void res.json({
      type: "clarify",
      question: `ما ثبت عندي الزبون «${parsed.customerName}».${suffix}`,
    });
  }
  const customer = customerResult.match;

  if (parsed.type === "VOUCHER") {
    if (!parsed.amount || parsed.amount <= 0) {
      return void res.json({ type: "clarify", question: "شكد مبلغ السند؟" });
    }
    const voucherType = parsed.voucherType === "PAYMENT" ? VoucherType.PAYMENT : VoucherType.RECEIPT;
    const plan: VoicePlan = {
      operation: "VOUCHER",
      customerId: customer.id,
      customerName: customer.name,
      amount: parsed.amount,
      voucherType,
    };
    return void res.json({
      type: "confirm",
      plan,
      confirmText: `راح أسجل سند ${voucherType === VoucherType.PAYMENT ? "دفع" : "قبض"} على ${customer.name} بمبلغ ${parsed.amount.toLocaleString("en-US")} د.ع.`,
    });
  }

  const parsedItems = (parsed.items ?? []).filter((item) => item.productName?.trim());
  if (!parsedItems.length) {
    return void res.json({ type: "clarify", question: "شنو المادة اللي تريد تسجلها؟" });
  }

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      salePrice: true,
      pcsPerCarton: true,
    },
    orderBy: { name: "asc" },
    take: 10000,
  });

  const items: VoicePlanItem[] = [];
  for (const parsedItem of parsedItems) {
    const productResult = chooseMatch(parsedItem.productName!, products);
    if (!productResult.match) {
      const suffix = productResult.suggestions.length
        ? ` تقصد: ${productResult.suggestions.join("، ")}؟`
        : "";
      return void res.json({
        type: "clarify",
        question: `ما ثبتت مادة «${parsedItem.productName}».${suffix}`,
      });
    }
    const product = productResult.match;
    const quantity = Math.max(1, Math.trunc(parsedItem.quantity ?? 1));
    const unit = parsedItem.unit ?? Unit.PIECE;
    const basePrice = Number(product.salePrice);
    const unitPrice = parsedItem.unitPrice && parsedItem.unitPrice >= 0
      ? parsedItem.unitPrice
      : unit === Unit.CARTON
        ? basePrice * product.pcsPerCarton
        : unit === Unit.DOZEN
          ? basePrice * 12
          : basePrice;
    items.push({
      productId: product.id,
      productName: product.name,
      quantity,
      unit,
      unitPrice,
      totalPrice: unitPrice * quantity,
    });
  }

  const totalAmount = items.reduce((sum, item) => sum + item.totalPrice, 0);
  const paymentType = parsed.paymentType ?? PaymentType.CASH;
  const paidAmount = paymentType === PaymentType.CASH
    ? totalAmount
    : paymentType === PaymentType.CREDIT
      ? 0
      : Math.max(0, Math.min(totalAmount, parsed.paidAmount ?? 0));
  const unitLabels: Record<Unit, string> = {
    PIECE: "قطعة",
    DOZEN: "درزن",
    CARTON: "كارتون",
  };
  const itemSummary = items
    .map((item) => `${item.quantity} ${unitLabels[item.unit]} ${item.productName}`)
    .join("، ");
  const payLabel = paymentType === PaymentType.CASH ? "نقد" : paymentType === PaymentType.CREDIT ? "آجل" : `واصل ${paidAmount.toLocaleString("en-US")}`;
  const plan: VoicePlan = {
    operation: "INVOICE",
    customerId: customer.id,
    customerName: customer.name,
    items,
    totalAmount,
    paymentType,
    paidAmount,
  };

  return void res.json({
    type: "confirm",
    plan,
    confirmText: `فهمت عليك: فاتورة على ${customer.name}، ${itemSummary}، المجموع ${totalAmount.toLocaleString("en-US")} د.ع، ${payLabel}. أثبتها؟`,
  });
});

export const executeVoiceCommand = asyncHandler(async (req, res) => {
  const { plan } = req.body as { plan?: VoicePlan };
  if (!plan?.operation || !plan.customerId) {
    throw new AppError("خطة التنفيذ ناقصة", 400, "INVALID_PLAN");
  }
  const userId = req.user!.id;

  if (plan.operation === "VOUCHER") {
    if (!plan.amount || !plan.voucherType) {
      throw new AppError("معلومات السند ناقصة", 400, "INVALID_VOUCHER_PLAN");
    }
    const voucher = await createVoucher(
      {
        customerId: plan.customerId,
        amount: plan.amount,
        type: plan.voucherType,
        notes: "أُنشئ بواسطة المساعد الذكي",
      },
      userId
    );
    return void res.status(201).json({
      success: true,
      message: `تم إنشاء السند ${voucher.voucherNumber}`,
      voucher: {
        id: voucher.id,
        voucherNumber: voucher.voucherNumber,
        customerName: plan.customerName,
        amount: plan.amount,
        type: plan.voucherType,
      },
    });
  }

  if (!plan.items?.length || !plan.paymentType) {
    throw new AppError("معلومات الفاتورة ناقصة", 400, "INVALID_INVOICE_PLAN");
  }
  const invoice = await createInvoice(
    {
      customerId: plan.customerId,
      type: "SALE",
      discount: 0,
      tax: 0,
      paidAmount: plan.paidAmount ?? 0,
      paymentType: plan.paymentType,
      items: plan.items.map((item) => ({
        productId: item.productId,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    },
    userId
  );
  return void res.status(201).json({
    success: true,
    message: `تم إنشاء الفاتورة ${invoice.invoiceNumber}`,
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: plan.customerName,
      items: plan.items,
      totalAmount: plan.totalAmount,
      paymentType: plan.paymentType,
    },
  });
});
