import Groq from "groq-sdk";
import prisma from "../config/database";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!process.env.GROQ_API_KEY) throw new AppError("Ø®Ø¯Ù…Ø© OCR ØºÙŠØ± Ù…ÙØ¹Ù„Ø©", 503, "GROQ_NOT_CONFIGURED");
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const scanInvoiceImage = asyncHandler(async (req, res) => {
  const { imageBase64 } = req.body as { imageBase64?: string };

  if (!imageBase64) {
    throw new AppError("Ø§Ù„ØµÙˆØ±Ø© Ù…Ø·Ù„ÙˆØ¨Ø©", 400, "IMAGE_REQUIRED");
  }

  // ØªØ­Ù‚Ù‚ Ù…Ù† ØµÙŠØºØ© base64 (ÙŠØ¬Ø¨ Ø£Ù† ØªØ¨Ø¯Ø£ Ø¨Ù€ data:image/...)
  const isValidImage = /^data:image\/(jpeg|jpg|png|webp|gif);base64,/.test(imageBase64);
  if (!isValidImage) {
    throw new AppError("ØµÙŠØºØ© Ø§Ù„ØµÙˆØ±Ø© ØºÙŠØ± ØµØ­ÙŠØ­Ø©", 400, "INVALID_IMAGE");
  }

  // â”€â”€ Ø§Ù„Ø®Ø·ÙˆØ© 1: Groq Vision ÙŠÙ‚Ø±Ø£ Ø§Ù„ÙØ§ØªÙˆØ±Ø© â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const completion = await getGroq().chat.completions.create({
    model: "llama-3.2-11b-vision-preview",   // Ø§Ù„Ù…ÙˆØ¯ÙŠÙ„ Ø§Ù„Ø±Ø³Ù…ÙŠ Ù„Ù„ØµÙˆØ± Ø¹Ù„Ù‰ Groq
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
            text: `Ø£Ù†Øª Ù†Ø¸Ø§Ù… OCR Ù„Ù‚Ø±Ø§Ø¡Ø© ÙÙˆØ§ØªÙŠØ± Ø§Ù„Ø´Ø±Ø§Ø¡ Ø§Ù„Ø¹Ø±Ø§Ù‚ÙŠØ©.
Ø§Ù‚Ø±Ø£ Ù‡Ø°Ù‡ Ø§Ù„ÙØ§ØªÙˆØ±Ø© ÙˆØ§Ø³ØªØ®Ø±Ø¬ Ø¬Ù…ÙŠØ¹ Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª Ø¨Ø¯Ù‚Ø©.

Ø£Ø¬Ø¨ Ø¨Ù€ JSON ÙÙ‚Ø· Ø¨Ù‡Ø°Ø§ Ø§Ù„Ø´ÙƒÙ„:
{
  "supplierName": "Ø§Ø³Ù… Ø§Ù„Ù…ÙˆØ±Ø¯ Ø¥Ø°Ø§ Ù…ÙˆØ¬ÙˆØ¯ Ø£Ùˆ null",
  "invoiceDate": "ØªØ§Ø±ÙŠØ® Ø§Ù„ÙØ§ØªÙˆØ±Ø© YYYY-MM-DD Ø¥Ø°Ø§ Ù…ÙˆØ¬ÙˆØ¯ Ø£Ùˆ null",
  "notes": "Ø£ÙŠ Ù…Ù„Ø§Ø­Ø¸Ø© Ù…Ù‡Ù…Ø© Ø£Ùˆ null",
  "items": [
    {
      "productName": "Ø§Ø³Ù… Ø§Ù„Ù…Ù†ØªØ¬ ÙƒÙ…Ø§ Ù‡Ùˆ Ù…ÙƒØªÙˆØ¨",
      "quantity": 1,
      "unit": "PIECE Ø£Ùˆ DOZEN Ø£Ùˆ CARTON",
      "unitPrice": 0
    }
  ]
}

Ù‚ÙˆØ§Ø¹Ø¯:
- unit: Ø¥Ø°Ø§ Ø°ÙÙƒØ± ÙƒØ±ØªÙˆÙ† Ø£Ùˆ ÙƒØ§Ø±ØªÙˆÙ† â†’ CARTONØŒ Ø¯Ø±Ø²Ù† â†’ DOZENØŒ ØºÙŠØ± Ø°Ù„Ùƒ â†’ PIECE
- unitPrice: Ø§Ù„Ø³Ø¹Ø± Ù„Ù„ÙˆØ­Ø¯Ø© Ø§Ù„ÙˆØ§Ø­Ø¯Ø© (Ù„ÙŠØ³ Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠ)
- Ø¥Ø°Ø§ Ù…ÙƒØªÙˆØ¨ "Ø¥Ø¬Ù…Ø§Ù„ÙŠ" ÙÙ‚Ø· Ø¨Ø¯ÙˆÙ† Ø³Ø¹Ø± ÙˆØ­Ø¯Ø©ØŒ Ø§Ø­Ø³Ø¨: Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ã· ÙƒÙ…ÙŠØ©
- Ø§ÙƒØªØ¨ Ø£Ø³Ù…Ø§Ø¡ Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª ÙƒÙ…Ø§ Ù‡ÙŠ Ø¨Ø§Ù„Ø¹Ø±Ø¨ÙŠ Ø£Ùˆ Ø§Ù„Ø¥Ù†Ø¬Ù„ÙŠØ²ÙŠ
- Ø¥Ø°Ø§ Ø§Ù„ØµÙˆØ±Ø© ØºÙŠØ± ÙˆØ§Ø¶Ø­Ø© Ø£Ùˆ Ù„ÙŠØ³Øª ÙØ§ØªÙˆØ±Ø©: items ØªÙƒÙˆÙ† []`,
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
    throw new AppError("ÙØ´Ù„ ÙÙŠ Ù‚Ø±Ø§Ø¡Ø© Ø§Ù„ÙØ§ØªÙˆØ±Ø© â€” Ø¬Ø±Ø¨ ØµÙˆØ±Ø© Ø£ÙˆØ¶Ø­", 422, "PARSE_ERROR");
  }

  if (!extracted.items || extracted.items.length === 0) {
    return void res.json({
      success: false,
      message: "Ù…Ø§ Ù‚Ø¯Ø±Øª Ø£Ù‚Ø±Ø£ Ù…Ù†ØªØ¬Ø§Øª Ù…Ù† Ù‡Ø°Ù‡ Ø§Ù„ØµÙˆØ±Ø© â€” ØªØ£ÙƒØ¯ Ø£Ù† Ø§Ù„ØµÙˆØ±Ø© ÙˆØ§Ø¶Ø­Ø©",
      items: [],
    });
  }

  // â”€â”€ Ø§Ù„Ø®Ø·ÙˆØ© 2: Ø§Ø¨Ø­Ø« Ø¹Ù† ÙƒÙ„ Ù…Ù†ØªØ¬ ÙÙŠ Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const matchedItems = await Promise.all(
    extracted.items.map(async (item) => {
      // Ø¨Ø­Ø« Ø°ÙƒÙŠ: Ø¬Ø²Ø¡ Ù…Ù† Ø§Ù„Ø§Ø³Ù…ØŒ ØºÙŠØ± Ø­Ø³Ø§Ø³ Ù„Ø­Ø¬Ù… Ø§Ù„Ø­Ø±Ù
      const words = item.productName
        .split(/\s+/)
        .filter((w) => w.length > 1)
        .slice(0, 3); // Ø£ÙˆÙ„ 3 ÙƒÙ„Ù…Ø§Øª

      // Ø¬Ø±Ù‘Ø¨ Ø§Ù„Ø¨Ø­Ø« Ø¨Ø§Ù„Ø§Ø³Ù… Ø§Ù„ÙƒØ§Ù…Ù„ Ø£ÙˆÙ„Ø§Ù‹
      let products = await prisma.product.findMany({
        where: {
          deletedAt: null,
          name: { contains: item.productName },
        },
        take: 3,
      });

      // Ø¥Ø°Ø§ Ù…Ø§ ÙˆØ¬Ø¯ â€” Ø¬Ø±Ù‘Ø¨ Ø¨Ø£ÙˆÙ„ ÙƒÙ„Ù…Ø©
      if (products.length === 0 && words[0]) {
        products = await prisma.product.findMany({
          where: {
            deletedAt: null,
            name: { contains: words[0] },
          },
          take: 3,
        });
      }

      const matched = products[0] ?? null;
      const suggestions = products.map((product) => ({
        id: product.id,
        name: product.name,
        itemNumber: product.itemNumber,
        purchasePrice: Number(product.purchasePrice),
        salePrice: Number(product.salePrice),
        pcsPerCarton: product.pcsPerCarton,
      }));

      return {
        // Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø³ØªØ®Ø±Ø¬Ø© Ù…Ù† Ø§Ù„ØµÙˆØ±Ø©
        extractedName: item.productName,
        quantity: Math.max(1, Math.round(item.quantity)),
        unit: item.unit,
        unitPrice: item.unitPrice,

        // Ø§Ù„Ù…Ù†ØªØ¬ Ø§Ù„Ù…Ø·Ø§Ø¨Ù‚ Ù…Ù† Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª (Ø£Ùˆ null)
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

        suggestions,
        matched: matched !== null,
      };
    })
  );

  const matchedCount = matchedItems.filter((i) => i.matched).length;

  return void res.json({
    success: true,
    message: `Ù‚Ø±Ø£Øª ${extracted.items.length} Ù…Ù†ØªØ¬ â€” Ø·Ø§Ø¨Ù‚Øª ${matchedCount} Ù…Ù†Ù‡Ù… ÙÙŠ Ø§Ù„Ù…Ø®Ø²ÙˆÙ†`,
    supplierName: extracted.supplierName ?? null,
    invoiceDate: extracted.invoiceDate ?? null,
    notes: extracted.notes ?? null,
    items: matchedItems,
  });
});
