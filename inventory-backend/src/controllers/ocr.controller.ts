import Groq from "groq-sdk";
import prisma from "../config/database";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExtractedItem {
  productName: string;
  quantity: number;
  unit: "PIECE" | "DOZEN" | "CARTON";
  unitPrice: number;
}

interface GroqExtractResult {
  items?: ExtractedItem[];
  supplierName?: string;
  invoiceDate?: string;
  notes?: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const scanInvoiceImage = asyncHandler(async (req, res) => {
  const { imageBase64 } = req.body as { imageBase64?: string };

  if (!imageBase64) {
    throw new AppError("الصورة مطلوبة", 400, "IMAGE_REQUIRED");
  }

  // تحقق من صيغة base64 (يجب أن تبدأ بـ data:image/...)
  const isValidImage = /^data:image\/(jpeg|jpg|png|webp|gif);base64,/.test(imageBase64);
  if (!isValidImage) {
    throw new AppError("صيغة الصورة غير صحيحة", 400, "INVALID_IMAGE");
  }

  // ── الخطوة 1: Groq Vision يقرأ الفاتورة ──────────────────────────────────
  const completion = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: imageBase64 },
          },
          {
            type: "text",
            text: `أنت نظام OCR لقراءة فواتير الشراء العراقية.
اقرأ هذه الفاتورة واستخرج جميع المنتجات بدقة.

أجب بـ JSON فقط بهذا الشكل:
{
  "supplierName": "اسم المورد إذا موجود أو null",
  "invoiceDate": "تاريخ الفاتورة YYYY-MM-DD إذا موجود أو null",
  "notes": "أي ملاحظة مهمة أو null",
  "items": [
    {
      "productName": "اسم المنتج كما هو مكتوب",
      "quantity": 1,
      "unit": "PIECE أو DOZEN أو CARTON",
      "unitPrice": 0
    }
  ]
}

قواعد:
- unit: إذا ذُكر كرتون أو كارتون → CARTON، درزن → DOZEN، غير ذلك → PIECE
- unitPrice: السعر للوحدة الواحدة (ليس الإجمالي)
- إذا مكتوب "إجمالي" فقط بدون سعر وحدة، احسب: إجمالي ÷ كمية
- اكتب أسماء المنتجات كما هي بالعربي أو الإنجليزي
- إذا الصورة غير واضحة أو ليست فاتورة: items تكون []`,
          },
        ],
      },
    ],
  });

  let extracted: GroqExtractResult;
  try {
    extracted = JSON.parse(
      completion.choices[0]?.message?.content ?? "{}"
    ) as GroqExtractResult;
  } catch {
    throw new AppError("فشل في قراءة الفاتورة — جرب صورة أوضح", 422, "PARSE_ERROR");
  }

  if (!extracted.items || extracted.items.length === 0) {
    return void res.json({
      success: false,
      message: "ما قدرت أقرأ منتجات من هذه الصورة — تأكد أن الصورة واضحة",
      items: [],
    });
  }

  // ── الخطوة 2: ابحث عن كل منتج في قاعدة البيانات ─────────────────────────
  const matchedItems = await Promise.all(
    extracted.items.map(async (item) => {
      // بحث ذكي: جزء من الاسم، غير حساس لحجم الحرف
      const words = item.productName
        .split(/\s+/)
        .filter((w) => w.length > 1)
        .slice(0, 3); // أول 3 كلمات

      // جرّب البحث بالاسم الكامل أولاً
      let products = await prisma.product.findMany({
        where: {
          deletedAt: null,
          name: { contains: item.productName, mode: "insensitive" },
        },
        take: 3,
      });

      // إذا ما وجد — جرّب بأول كلمة
      if (products.length === 0 && words[0]) {
        products = await prisma.product.findMany({
          where: {
            deletedAt: null,
            name: { contains: words[0], mode: "insensitive" },
          },
          take: 3,
        });
      }

      const matched = products[0] ?? null;

      return {
        // البيانات المستخرجة من الصورة
        extractedName: item.productName,
        quantity: Math.max(1, Math.round(item.quantity)),
        unit: item.unit,
        unitPrice: item.unitPrice,

        // المنتج المطابق من قاعدة البيانات (أو null)
        product: matched
          ? {
              id: matched.id,
              name: matched.name,
              itemNumber: matched.itemNumber,
              purchasePrice: Number(matched.purchasePrice),
              salePrice: Number(matched.salePrice),
              pcsPerCarton: matched.pcsPerCarton,
            }
          : null,

        matched: matched !== null,
      };
    })
  );

  const matchedCount = matchedItems.filter((i) => i.matched).length;

  return void res.json({
    success: true,
    message: `قرأت ${extracted.items.length} منتج — طابقت ${matchedCount} منهم في المخزون`,
    supplierName: extracted.supplierName ?? null,
    invoiceDate: extracted.invoiceDate ?? null,
    notes: extracted.notes ?? null,
    items: matchedItems,
  });
});
