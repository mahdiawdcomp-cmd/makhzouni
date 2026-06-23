import Groq from "groq-sdk";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!process.env.GROQ_API_KEY) throw new AppError("خدمة الذكاء الاصطناعي غير مفعلة", 503, "GROQ_NOT_CONFIGURED");
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

type AiResponse = {
  message: string;
  productIds: string[];
};

function toNumber(v: unknown) {
  return Number(v ?? 0);
}

function buildCatalogContext(items: Array<{
  id: string;
  title: string | null;
  description: string | null;
  price: unknown;
  categories: string[];
  product: { name: string } | null;
}>) {
  return items.map((item) => ({
    id: item.id,
    n: item.title || item.product?.name || "",
    d: item.description?.slice(0, 120) || "",
    p: toNumber(item.price),
    c: item.categories.join(", "),
  }));
}

const SYSTEM_PROMPT = `أنت مساعد تسوق ذكي ومحترف لمتجر عراقي. مهمتك مساعدة الزبون باختيار المنتب المناسب من الكتلوك الموجود فعلاً.

قواعدك:
- رد دائماً بالعربي (عراقي أو فصيح) — بأسلوب دافئ، محترم ومبتسم حتى لو السؤال غريب.
- افهم ما يريده الزبون حتى لو ما قاله بوضوح:
  • "للبنت عمرها 5" → ألعاب بنات أطفال
  • "هدية لأمي" → منتجات مناسبة للنساء الكبار
  • "ميزانيتي 20 الف / عندي 15 ألف" → صفّي حسب السعر
  • "شي حلو للبيت" → ديكور أو لوازم منزلية
  • الطياره / سياره / دودة / بوكيمون / باربي → تعرف على نوع الألعاب
- إذا ما في منتجات مناسبة فعلاً، قول له بلطف واقترح الأقرب.
- اقترح 1-5 منتجات فعلية من الكتلوك (ID حقيقي).
- ما تخترع منتجات غير موجودة.

الكتلوج الحالي (JSON):
__CATALOG__

أرجع JSON فقط بهذا الشكل (بدون أي نص خارجه):
{
  "message": "رد للزبون بالعربي",
  "productIds": ["id1", "id2"]
}`;

export async function retailAiChat(
  message: string,
  history: ChatMessage[],
  storeName: string,
): Promise<AiResponse> {
  if (!process.env.GROQ_API_KEY) {
    throw new AppError("خدمة الذكاء الاصطناعي غير مفعلة", 503, "AI_NOT_CONFIGURED");
  }

  const items = await prisma.retailCatalogItem.findMany({
    where: { isActive: true },
    include: { product: { select: { name: true } } },
    orderBy: [{ featured: "desc" }, { sortOrder: "asc" }],
    take: 200,
  });

  const catalog = buildCatalogContext(items.map((i) => ({
    ...i,
    categories: Array.isArray(i.categories) ? (i.categories as string[]) : [],
  })));
  const systemPrompt = SYSTEM_PROMPT
    .replace("__CATALOG__", JSON.stringify(catalog))
    .replace("مساعد تسوق ذكي ومحترف لمتجر عراقي", `مساعد تسوق ذكي ومحترف لمتجر "${storeName}"`);

  const safeHistory = history
    .filter((m) => m?.content?.trim())
    .slice(-6)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 400) }));

  const completion = await getGroq().chat.completions.create({
    model: "llama-3.3-70b-versatile",
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      ...safeHistory,
      { role: "user", content: message.trim().slice(0, 500) },
    ],
  });

  let parsed: AiResponse;
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as AiResponse;
  } catch {
    parsed = { message: "آسف، ما قدرت أفهم طلبك. حاول تكتب بشكل أوضح 😊", productIds: [] };
  }

  if (!parsed.message) parsed.message = "شلون أقدر أساعدك اليوم؟ 😊";
  if (!Array.isArray(parsed.productIds)) parsed.productIds = [];

  // Validate returned IDs actually exist in catalog
  const validIds = new Set(items.map((i) => i.id));
  parsed.productIds = parsed.productIds.filter((id) => validIds.has(id)).slice(0, 5);

  return parsed;
}
