// بند ٤ من خطة قمع الواتساب: تصنيف كل محافظة إما ضمن "وسط/جنوب/غرب" (توصيل
// مجاني فوق حد معيّن) أو "الشمال" (حسب البضاعة). القائمة الجغرافية ثابتة؛
// الانتماء لمنطقة قابل للتعديل من إعدادات إدارة الكتلوك (catalogNorthGovernorates).

export const IRAQI_GOVERNORATES = [
  "بغداد",
  "كربلاء",
  "النجف",
  "بابل",
  "الديوانية",
  "واسط",
  "ميسان",
  "ذي قار",
  "المثنى",
  "البصرة",
  "الأنبار",
  "ديالى",
  "صلاح الدين",
  "نينوى",
  "أربيل",
  "السليمانية",
  "دهوك",
  "كركوك",
  "حلبجة",
] as const;

export type IraqiGovernorate = (typeof IRAQI_GOVERNORATES)[number];

// الافتراضي يطابق جدول الخطة بالضبط — ديالى وصلاح الدين ضمن وسط/جنوب/غرب،
// كركوك ضمن الشمال، بلا استثناءات حدودية.
export const DEFAULT_NORTH_GOVERNORATES: IraqiGovernorate[] = [
  "نينوى",
  "أربيل",
  "السليمانية",
  "دهوك",
  "كركوك",
  "حلبجة",
];

export const DEFAULT_FREE_SHIPPING_THRESHOLD = 1_500_000;

export const CUSTOMER_BUSINESS_TYPES = ["STATIONERY", "TOYS", "MIXED"] as const;
export type CustomerBusinessType = (typeof CUSTOMER_BUSINESS_TYPES)[number];

export const BUSINESS_TYPE_LABELS: Record<CustomerBusinessType, string> = {
  STATIONERY: "قرطاسية",
  TOYS: "ألعاب",
  MIXED: "مختلط",
};

export function isNorthGovernorate(province: string, northList?: string[] | null) {
  return (northList ?? DEFAULT_NORTH_GOVERNORATES).includes(province);
}

/**
 * The single delivery sentence a shopper sees — no per-governorate detail,
 * just "free above X" or "priced per order" per بند ٤ decision #5.
 */
export function buildDeliveryLine(
  province: string | null | undefined,
  settings: { catalogNorthGovernorates?: string[]; catalogFreeShippingThreshold?: number } | null | undefined,
): string | null {
  if (!province) return null;

  if (isNorthGovernorate(province, settings?.catalogNorthGovernorates)) {
    return "التوصيل لمنطقتك حسب البضاعة — نحسبه ونبلغك.";
  }

  const threshold = settings?.catalogFreeShippingThreshold ?? DEFAULT_FREE_SHIPPING_THRESHOLD;
  return `توصيل مجاني للطلبات فوق ${threshold.toLocaleString("en-US")} دينار.`;
}
