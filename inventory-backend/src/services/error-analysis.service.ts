import Groq from "groq-sdk";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";

// AI analysis of a logged system error. Manual only (a button per error) — never
// runs automatically. Requires GROQ_API_KEY; otherwise the caller gets a clear
// "not enabled" error. All data is SANITIZED before leaving the server.

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!process.env.GROQ_API_KEY) {
    throw new AppError("التحليل بالذكاء غير مفعّل", 503, "AI_NOT_CONFIGURED");
  }
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

export function isAiEnabled(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

// Redaction: strip anything that could leak PII or secrets before sending to the
// LLM. Phone numbers, long tokens/keys, connection strings, bearer headers, and
// money amounts are masked. Applied recursively to the whole context blob.
const PHONE_RE = /\b\d{7,15}\b/g;
const TOKEN_RE = /\b[A-Za-z0-9_-]{24,}\b/g;
const URL_CRED_RE = /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._-]+/gi;
const MONEY_RE = /\b\d[\d,]{3,}(?:\.\d+)?\s*(?:د\.ع|iqd|usd|\$)?/gi;

export function sanitizeText(input: string): string {
  return input
    .replace(URL_CRED_RE, "[db-url]")
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(TOKEN_RE, "[token]")
    .replace(PHONE_RE, "[phone]")
    .replace(MONEY_RE, "[amount]");
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Drop obviously sensitive keys outright.
      if (/token|secret|password|key|authorization|dburl|database_url|phone|name/i.test(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = sanitizeValue(v);
      }
    }
    return out;
  }
  return value;
}

const SYSTEM_PROMPT = `أنت مهندس دعم فني خبير في أنظمة Node.js وواتساب (Green API) وPostgreSQL.
ستصلك بيانات خطأ من نظام محاسبة/مخزون — كل البيانات الحساسة محجوبة مسبقاً ([phone], [token], [amount]...).
مهمتك تحليل الخطأ بإيجاز ورد JSON فقط بهذا الشكل بدون أي نص خارجه:
{
  "summary": "شرح مبسط للمشكلة بالعربي",
  "likelyCause": "السبب الأرجح",
  "suggestedFix": "خطوات الإصلاح المقترحة بشكل عملي ومختصر",
  "severity": "low | medium | high"
}`;

export type ErrorAnalysis = {
  summary: string;
  likelyCause: string;
  suggestedFix: string;
  severity: string;
};

export async function analyzeErrorLog(id: string): Promise<ErrorAnalysis> {
  const err = await prisma.errorLog.findUnique({ where: { id } });
  if (!err) throw new AppError("سجل الخطأ غير موجود", 404, "ERROR_LOG_NOT_FOUND");

  const payload = sanitizeValue({
    source: err.source,
    level: err.level,
    code: err.code,
    message: err.message,
    count: err.count,
    context: err.context ?? null,
  });

  const completion = await getGroq().chat.completions.create({
    model: "llama-3.3-70b-versatile",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(payload).slice(0, 4000) },
    ],
  });

  let parsed: Partial<ErrorAnalysis> = {};
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Partial<ErrorAnalysis>;
  } catch {
    parsed = {};
  }

  return {
    summary: parsed.summary || "تعذّر تحليل الخطأ.",
    likelyCause: parsed.likelyCause || "غير معروف.",
    suggestedFix: parsed.suggestedFix || "راجع سجلات الخادم للمزيد من التفاصيل.",
    severity: parsed.severity || "medium",
  };
}
