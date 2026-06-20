import Groq from "groq-sdk";
import { InvoiceStatus, InvoiceType, PaymentType, Unit, VoucherType } from "@prisma/client";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "groq-sdk/resources/chat/completions";
import prisma from "../config/database";
import { createInvoice } from "../services/invoice.service";
import { createVoucher } from "../services/voucher.service";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type JsonRecord = Record<string, unknown>;

let groq: Groq | null = null;
function getGroq(): Groq {
  if (!process.env.GROQ_API_KEY) throw new AppError("خدمة المحادثة غير مفعلة حالياً", 503, "GROQ_NOT_CONFIGURED");
  if (!groq) groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groq;
}

const SYSTEM_PROMPT = `أنت مساعد ذكي متخصص فقط في نظام إدارة مخزون ومحاسبة عراقي اسمه مخزوني.
لا تجيب على أي سؤال خارج نطاق النظام — الطبخ، الأخبار، العلوم، السياسة، أي موضوع عام.
إذا سألك شيء غير متعلق بالنظام قل بالضبط: "أنا مختص فقط بنظام المخزون، اسألني عن زبائنك أو منتجاتك أو مبيعاتك."
تتكلم العربية العراقية العامية، أجوبة مختصرة مباشرة مناسبة للصوت.
لا تستخدم bullet points أو markdown — الجواب يُقرأ صوتياً.`;

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_customer_balance",
      description: "Get customer balance by customer name.",
      parameters: {
        type: "object",
        properties: { customerName: { type: "string" } },
        required: ["customerName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_today_sales",
      description: "Get today's active sale totals.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_low_stock",
      description: "Get low-stock products.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "search_product",
      description: "Search product by name.",
      parameters: {
        type: "object",
        properties: { productName: { type: "string" } },
        required: ["productName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_customers",
      description: "Get top customers by sales since start of month.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_total_debts",
      description: "Get total positive customer debts.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "create_invoice",
      description: "Create a sale invoice by customer and product name.",
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string" },
          productName: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string", enum: ["PIECE", "DOZEN", "CARTON"] },
          unitPrice: { type: "number" },
          paymentType: { type: "string", enum: ["CASH", "CREDIT", "PARTIAL"] },
        },
        required: ["customerName", "productName", "quantity", "unit", "paymentType"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_voucher",
      description: "Create a receipt or payment voucher by customer name.",
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string" },
          amount: { type: "number" },
          type: { type: "string", enum: ["RECEIPT", "PAYMENT"] },
        },
        required: ["customerName", "amount", "type"],
      },
    },
  },
];

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function getString(input: JsonRecord, key: string) {
  const value = input[key];
  return typeof value === "string" ? value.trim() : "";
}

function getPositiveNumber(input: JsonRecord, key: string) {
  const value = Number(input[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function parseArgs(raw: string | undefined): JsonRecord {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as JsonRecord : {};
  } catch {
    return {};
  }
}

function currentStock(product: {
  openingBalancePcs: number;
  cartonsAvailable: number;
  pcsPerCarton: number;
}) {
  return product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton;
}

function normalizeArabic(value: string) {
  return value
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export async function answerKnownInventoryQuestion(text: string) {
  const normalized = normalizeArabic(text);
  const asksLowStock =
    /(مواد|ماده|اصناف|بضاعه|منتجات)/.test(normalized) &&
    /(ناقص|ناقصه|قليل|منخفض|خلص|خلصان|نفد)/.test(normalized);

  if (asksLowStock) {
    const products = await runTool("get_low_stock", {}, "") as Array<{
      name: string;
      currentStock: number;
      minStock: number;
    }>;
    if (!products.length) {
      return "ماكو مواد ناقصة حالياً، كل المواد أعلى من حد التنبيه المحدد إلها.";
    }
    const details = products
      .map((product) => `${product.name}: المتوفر ${product.currentStock} والحد الأدنى ${product.minStock}`)
      .join("، ");
    return `عندك ${products.length} مواد ناقصة: ${details}.`;
  }

  if (/(مبيعات اليوم|بيع اليوم|بعت اليوم|مبيعاتنا اليوم)/.test(normalized)) {
    const result = await runTool("get_today_sales", {}, "") as {
      totalSales: number;
      invoiceCount: number;
      collected: number;
    };
    return `مبيعات اليوم ${result.totalSales.toLocaleString("en-US")} دينار من ${result.invoiceCount} فاتورة، والواصل ${result.collected.toLocaleString("en-US")} دينار.`;
  }

  if (/(مجموع الديون|كل الديون|ديون الزباين|ديون الزبائن)/.test(normalized)) {
    const result = await runTool("get_total_debts", {}, "") as {
      totalDebts: number;
      customerCount: number;
    };
    return `مجموع ديون الزبائن ${result.totalDebts.toLocaleString("en-US")} دينار على ${result.customerCount} زبون.`;
  }

  return null;
}

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

async function findCustomerByName(customerName: string) {
  const customer = await prisma.customer.findFirst({
    where: {
      deletedAt: null,
      name: { contains: customerName, mode: "insensitive" },
    },
    orderBy: { name: "asc" },
  });
  if (!customer) throw new AppError(`ما لقيت زبون باسم ${customerName}`, 404, "CUSTOMER_NOT_FOUND");
  return customer;
}

async function findProductByName(productName: string) {
  const product = await prisma.product.findFirst({
    where: {
      deletedAt: null,
      name: { contains: productName, mode: "insensitive" },
    },
    orderBy: { name: "asc" },
  });
  if (!product) throw new AppError(`ما لقيت مادة باسم ${productName}`, 404, "PRODUCT_NOT_FOUND");
  return product;
}

function unitPrice(product: { salePrice: unknown; pcsPerCarton: number }, unit: Unit, override?: number) {
  if (override !== undefined && Number.isFinite(override) && override >= 0) return override;
  const price = toNumber(product.salePrice);
  if (unit === Unit.CARTON) return price * product.pcsPerCarton;
  if (unit === Unit.DOZEN) return price * 12;
  return price;
}

async function runTool(name: string, args: JsonRecord, userId: string) {
  if (name === "get_customer_balance") {
    const customer = await findCustomerByName(getString(args, "customerName"));
    const balance = toNumber(customer.currentBalance);
    return {
      customerName: customer.name,
      currentBalance: balance,
      status: balance > 0 ? "عليه دين" : balance < 0 ? "إله رصيد" : "حسابه صفر",
    };
  }

  if (name === "get_today_sales") {
    const { start, end } = todayRange();
    const [totals, count] = await Promise.all([
      prisma.invoice.aggregate({
        where: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE, date: { gte: start, lt: end } },
        _sum: { totalAmount: true, paidAmount: true },
      }),
      prisma.invoice.count({
        where: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE, date: { gte: start, lt: end } },
      }),
    ]);
    return {
      totalSales: toNumber(totals._sum.totalAmount),
      invoiceCount: count,
      collected: toNumber(totals._sum.paidAmount),
    };
  }

  if (name === "get_low_stock") {
    const products = await prisma.product.findMany({
      where: { deletedAt: null, minStock: { gt: 0 } },
      orderBy: { name: "asc" },
    });
    return products
      .map((product) => ({
        name: product.name,
        currentStock: currentStock(product),
        minStock: product.minStock,
      }))
      .filter((product) => product.currentStock <= product.minStock)
      .slice(0, 8);
  }

  if (name === "search_product") {
    const product = await findProductByName(getString(args, "productName"));
    return {
      name: product.name,
      salePrice: toNumber(product.salePrice),
      currentStock: currentStock(product),
    };
  }

  if (name === "get_top_customers") {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const grouped = await prisma.invoice.groupBy({
      by: ["customerId"],
      where: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE, date: { gte: start } },
      _sum: { totalAmount: true },
      orderBy: { _sum: { totalAmount: "desc" } },
      take: 5,
    });
    const customers = await prisma.customer.findMany({
      where: { id: { in: grouped.map((row) => row.customerId) } },
      select: { id: true, name: true },
    });
    return grouped.map((row) => ({
      customerName: customers.find((customer) => customer.id === row.customerId)?.name ?? row.customerId,
      totalAmount: toNumber(row._sum.totalAmount),
    }));
  }

  if (name === "get_total_debts") {
    const [totals, count] = await Promise.all([
      prisma.customer.aggregate({
        where: { deletedAt: null, currentBalance: { gt: 0 } },
        _sum: { currentBalance: true },
      }),
      prisma.customer.count({ where: { deletedAt: null, currentBalance: { gt: 0 } } }),
    ]);
    return { totalDebts: toNumber(totals._sum.currentBalance), customerCount: count };
  }

  if (name === "create_invoice") {
    const customer = await findCustomerByName(getString(args, "customerName"));
    const product = await findProductByName(getString(args, "productName"));
    const quantity = Math.max(1, Math.round(getPositiveNumber(args, "quantity")));
    const unit = (getString(args, "unit") || "PIECE") as Unit;
    const paymentType = (getString(args, "paymentType") || "CASH") as PaymentType;
    const price = unitPrice(product, unit, args.unitPrice === undefined ? undefined : Number(args.unitPrice));
    const totalAmount = price * quantity;
    const paidAmount =
      paymentType === PaymentType.CASH ? totalAmount :
      paymentType === PaymentType.PARTIAL ? totalAmount / 2 :
      0;
    const invoice = await createInvoice(
      {
        customerId: customer.id,
        type: InvoiceType.SALE,
        discount: 0,
        tax: 0,
        paidAmount,
        paymentType,
        items: [{ productId: product.id, unit, quantity, unitPrice: price }],
      },
      userId,
    );
    return {
      invoiceNumber: invoice.invoiceNumber,
      customerName: customer.name,
      totalAmount: invoice.totalAmount,
    };
  }

  if (name === "create_voucher") {
    const customer = await findCustomerByName(getString(args, "customerName"));
    const amount = getPositiveNumber(args, "amount");
    const type = (getString(args, "type") || "RECEIPT") as VoucherType;
    const voucher = await createVoucher(
      {
        customerId: customer.id,
        amount,
        type,
        notes: "أنشئ بواسطة المساعد الذكي",
      },
      userId,
    );
    return {
      voucherNumber: voucher.voucherNumber,
      customerName: customer.name,
      amount: voucher.amount,
      type,
    };
  }

  throw new AppError("Unsupported agent tool", 400, "AGENT_TOOL_UNSUPPORTED");
}

function normalizeHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const row = item as { role?: unknown; content?: unknown };
      if ((row.role !== "user" && row.role !== "assistant") || typeof row.content !== "string") return null;
      return { role: row.role, content: row.content };
    })
    .filter((item): item is ChatMessage => item !== null)
    .slice(-6);
}

export const agentChat = asyncHandler(async (req, res) => {
  const { message, history } = req.body as { message?: unknown; history?: unknown };
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) throw new AppError("رسالة المساعد فارغة", 400, "AGENT_EMPTY_MESSAGE");
  if (!req.user?.id) throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");

  const cleanHistory = normalizeHistory(history);
  const directReply = await answerKnownInventoryQuestion(text);
  if (directReply) {
    const nextHistory: ChatMessage[] = [
      ...cleanHistory,
      { role: "user", content: text },
      { role: "assistant", content: directReply },
    ].slice(-6) as ChatMessage[];
    return void res.json({ success: true, reply: directReply, history: nextHistory });
  }
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...cleanHistory,
    { role: "user", content: text },
  ];

  let finalReply = "";
  for (let round = 0; round < 3; round++) {
    const completion = await getGroq().chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      messages,
      tools,
      tool_choice: "auto",
    });
    const choice = completion.choices[0];
    const assistantMessage = choice?.message;
    if (!assistantMessage) break;

    messages.push({
      role: "assistant",
      content: assistantMessage.content ?? null,
      tool_calls: assistantMessage.tool_calls,
    });

    if (!assistantMessage.tool_calls?.length) {
      finalReply = assistantMessage.content?.trim() || "ما عندي جواب واضح هسه.";
      break;
    }

    for (const toolCall of assistantMessage.tool_calls) {
      const result = await runTool(
        toolCall.function.name,
        parseArgs(toolCall.function.arguments),
        req.user.id,
      );
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  if (!finalReply) {
    finalReply = "تم تنفيذ الطلب، بس ما وصلني جواب نهائي واضح.";
  }

  const nextHistory: ChatMessage[] = [
    ...cleanHistory,
    { role: "user" as const, content: text },
    { role: "assistant" as const, content: finalReply },
  ].slice(-6);

  res.json({ success: true, reply: finalReply, history: nextHistory });
});
