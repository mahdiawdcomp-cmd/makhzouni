import Groq from "groq-sdk";
import type { ChatCompletionTool, ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import { InvoiceStatus, InvoiceType } from "@prisma/client";
import prisma from "../config/database";
import { createInvoice } from "../services/invoice.service";
import { createVoucher } from "../services/voucher.service";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── أدوات الـ Agent ────────────────────────────────────────────────────────────

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_customer_balance",
      description: "يجيب رصيد زبون أو مورد معين — يستخدم عند السؤال عن الدين أو الرصيد",
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string", description: "اسم الزبون أو جزء منه" },
        },
        required: ["customerName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_today_sales",
      description: "يجيب إجمالي مبيعات اليوم وعدد الفواتير",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_low_stock",
      description: "يجيب المنتجات التي شارفت على النفاد أو رصيدها منخفض",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "search_product",
      description: "يبحث عن منتج ويجيب سعره ورصيده",
      parameters: {
        type: "object",
        properties: {
          productName: { type: "string", description: "اسم المنتج أو جزء منه" },
        },
        required: ["productName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_customers",
      description: "يجيب أفضل الزبائن مبيعاً هذا الشهر",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_total_debts",
      description: "يجيب إجمالي الديون على الزبائن",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "create_invoice",
      description: "ينشئ فاتورة بيع جديدة",
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string" },
          productName:  { type: "string" },
          quantity:     { type: "number" },
          unit:         { type: "string", enum: ["PIECE", "DOZEN", "CARTON"] },
          unitPrice:    { type: "number" },
          paymentType:  { type: "string", enum: ["CASH", "CREDIT", "PARTIAL"] },
        },
        required: ["customerName", "productName", "quantity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_voucher",
      description: "ينشئ سند قبض أو دفع",
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string" },
          amount:       { type: "number" },
          type:         { type: "string", enum: ["RECEIPT", "PAYMENT"] },
        },
        required: ["customerName", "amount", "type"],
      },
    },
  },
];

// ── تنفيذ الأدوات ──────────────────────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>, userId: string): Promise<string> {
  const fmt = (n: number) => n.toLocaleString("en-US");

  switch (name) {

    case "get_customer_balance": {
      const customers = await prisma.customer.findMany({
        where: {
          deletedAt: null,
          name: { contains: String(args.customerName ?? ""), mode: "insensitive" },
        },
        take: 3,
      });
      if (customers.length === 0) return `ما لقيت زبون باسم "${args.customerName}"`;
      const c = customers[0];
      const balance = Number(c.currentBalance);
      const sign = balance > 0 ? "عليه" : balance < 0 ? "له" : "مسوّى";
      return `${c.name}: رصيده ${sign} ${fmt(Math.abs(balance))} دينار`;
    }

    case "get_today_sales": {
      const now = new Date();
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end   = new Date(now); end.setHours(23, 59, 59, 999);
      const result = await prisma.invoice.aggregate({
        where: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE, date: { gte: start, lte: end } },
        _sum: { totalAmount: true, paidAmount: true },
        _count: { id: true },
      });
      const total     = Number(result._sum.totalAmount ?? 0);
      const collected = Number(result._sum.paidAmount ?? 0);
      const count     = result._count.id;
      return `مبيعات اليوم: ${fmt(total)} دينار من ${count} فاتورة، تم تحصيل ${fmt(collected)} دينار`;
    }

    case "get_low_stock": {
      const products = await prisma.product.findMany({ where: { deletedAt: null } });
      const low = products.filter(p => {
        if (p.minStock <= 0) return false;
        const stock = p.openingBalancePcs + p.cartonsAvailable * p.pcsPerCarton;
        return stock <= p.minStock;
      }).slice(0, 8);
      if (low.length === 0) return "لا توجد منتجات منخفضة المخزون حالياً";
      return `منتجات شارفت على النفاد (${low.length}): ` +
        low.map(p => {
          const stock = p.openingBalancePcs + p.cartonsAvailable * p.pcsPerCarton;
          return `${p.name} (${stock} قطعة)`;
        }).join("، ");
    }

    case "search_product": {
      const products = await prisma.product.findMany({
        where: {
          deletedAt: null,
          name: { contains: String(args.productName ?? ""), mode: "insensitive" },
        },
        take: 3,
      });
      if (products.length === 0) return `ما لقيت منتج باسم "${args.productName}"`;
      return products.map(p => {
        const stock = p.openingBalancePcs + p.cartonsAvailable * p.pcsPerCarton;
        return `${p.name}: سعر البيع ${fmt(Number(p.salePrice))} دينار، المخزون ${stock} قطعة`;
      }).join(" | ");
    }

    case "get_top_customers": {
      const monthStart = new Date();
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const grouped = await prisma.invoice.groupBy({
        by: ["customerId"],
        where: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE, date: { gte: monthStart } },
        _sum: { totalAmount: true },
        orderBy: { _sum: { totalAmount: "desc" } },
        take: 5,
      });
      if (grouped.length === 0) return "ما في مبيعات هذا الشهر بعد";
      const ids = grouped.map(g => g.customerId);
      const customers = await prisma.customer.findMany({ where: { id: { in: ids } } });
      return "أفضل الزبائن هذا الشهر: " + grouped.map(g => {
        const c = customers.find(x => x.id === g.customerId);
        return `${c?.name ?? "—"} (${fmt(Number(g._sum.totalAmount ?? 0))} د.ع)`;
      }).join("، ");
    }

    case "get_total_debts": {
      const result = await prisma.customer.aggregate({
        where: { deletedAt: null, currentBalance: { gt: 0 } },
        _sum: { currentBalance: true },
        _count: { id: true },
      });
      return `إجمالي الديون: ${fmt(Number(result._sum.currentBalance ?? 0))} دينار على ${result._count.id} زبون`;
    }

    case "create_invoice": {
      const [customers, products] = await Promise.all([
        prisma.customer.findMany({
          where: { deletedAt: null, name: { contains: String(args.customerName ?? ""), mode: "insensitive" } },
          take: 1,
        }),
        prisma.product.findMany({
          where: { deletedAt: null, name: { contains: String(args.productName ?? ""), mode: "insensitive" } },
          take: 1,
        }),
      ]);
      if (!customers[0]) return `ما لقيت زبون باسم "${args.customerName}"`;
      if (!products[0]) return `ما لقيت منتج باسم "${args.productName}"`;

      const qty  = Number(args.quantity ?? 1);
      const unit = String(args.unit ?? "PIECE") as "PIECE" | "DOZEN" | "CARTON";
      const pay  = String(args.paymentType ?? "CASH") as "CASH" | "CREDIT" | "PARTIAL";
      const prod = products[0];
      const base = Number(prod.salePrice ?? 0);
      const uprice = Number(args.unitPrice ?? 0) ||
        (unit === "CARTON" ? base * prod.pcsPerCarton : unit === "DOZEN" ? base * 12 : base);
      const total = uprice * qty;

      const invoice = await createInvoice({
        customerId: customers[0].id,
        type: "SALE",
        discount: 0, tax: 0,
        paidAmount: pay === "CASH" ? total : 0,
        paymentType: pay,
        items: [{ productId: prod.id, unit, quantity: qty, unitPrice: uprice }],
      }, userId);

      return `تم إنشاء فاتورة رقم ${invoice.invoiceNumber} لـ ${customers[0].name}، ${qty} ${unit === "CARTON" ? "كرتون" : unit === "DOZEN" ? "درزن" : "قطعة"} ${prod.name} بـ ${fmt(total)} دينار`;
    }

    case "create_voucher": {
      const customers = await prisma.customer.findMany({
        where: { deletedAt: null, name: { contains: String(args.customerName ?? ""), mode: "insensitive" } },
        take: 1,
      });
      if (!customers[0]) return `ما لقيت زبون باسم "${args.customerName}"`;

      const amount = Number(args.amount ?? 0);
      const type   = String(args.type ?? "RECEIPT") as "RECEIPT" | "PAYMENT";
      const voucher = await createVoucher({
        customerId: customers[0].id,
        amount,
        type: type as never,
        notes: "أنشئ بالمساعد الذكي",
      }, userId);

      return `تم إنشاء ${type === "RECEIPT" ? "سند قبض" : "سند دفع"} رقم ${voucher.voucherNumber} لـ ${customers[0].name} بمبلغ ${fmt(amount)} دينار`;
    }

    default:
      return "أداة غير معروفة";
  }
}

// ── Main Handler ───────────────────────────────────────────────────────────────

export const agentChat = asyncHandler(async (req, res) => {
  const { message, history } = req.body as {
    message?: string;
    history?: ChatCompletionMessageParam[];
  };

  if (!message?.trim()) throw new AppError("الرسالة فارغة", 400, "EMPTY_MESSAGE");
  if (!process.env.GROQ_API_KEY) throw new AppError("GROQ_API_KEY غير مضبوط", 500, "GROQ_NOT_CONFIGURED");

  const userId = req.user!.id;

  const systemPrompt = `أنت مساعد ذكي لنظام إدارة مخزون عراقي اسمه "مخزوني".
تتحدث العربية العراقية وتجيب بشكل مختصر وودود.
عندك أدوات تقدر تستخدمها للإجابة على الأسئلة وتنفيذ العمليات.
إذا سألك عن رصيد أو مبيعات أو مخزون — استخدم الأدوات أولاً ثم أجب.
إذا طلبوا منك إنشاء فاتورة أو سند — استخدم الأداة المناسبة.
أجوبتك تكون صوتية — لا تستخدم رموز markdown أو نقاط أو قوائم.
تكلم بالعراقي: "زبون، گاتي، بيع، يدفع، عليه".`;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...(history ?? []).slice(-6),   // آخر 6 رسائل للسياق
    { role: "user", content: message.trim() },
  ];

  // ── حلقة الـ Agent (أقصى 3 جولات) ──────────────────────────────────────────
  let finalText = "";

  for (let round = 0; round < 3; round++) {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      max_tokens: 400,
      tools: TOOLS,
      tool_choice: "auto",
      messages,
    });

    const choice = completion.choices[0];
    if (!choice) break;

    const assistantMsg = choice.message;
    messages.push(assistantMsg as ChatCompletionMessageParam);

    // انتهى — جواب نهائي
    if (choice.finish_reason === "stop" || !assistantMsg.tool_calls?.length) {
      finalText = assistantMsg.content ?? "";
      break;
    }

    // استدعاء أدوات
    for (const toolCall of assistantMsg.tool_calls) {
      let toolResult: string;
      try {
        const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        toolResult = await executeTool(toolCall.function.name, args, userId);
      } catch {
        toolResult = "حصل خطأ في تنفيذ الأداة";
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResult,
      });
    }
  }

  if (!finalText) finalText = "ما قدرت أجيب على هذا السؤال، حاول مرة ثانية.";

  // أضف رسالة المستخدم للتاريخ اللي يرجع للـ Frontend
  const updatedHistory: ChatCompletionMessageParam[] = [
    ...(history ?? []).slice(-6),
    { role: "user", content: message.trim() },
    { role: "assistant", content: finalText },
  ];

  return void res.json({
    success: true,
    reply: finalText,
    history: updatedHistory,
  });
});
