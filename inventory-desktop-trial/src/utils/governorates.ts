// بند ٤ من خطة قمع الواتساب — نفس القائمة الجغرافية الثابتة المستخدمة بالباكند
// (utils/deliveryRegion.ts). القائمة نفسها ثابتة؛ تصنيف كل محافظة كـ"شمال" أو
// لا هو الجزء القابل للتعديل من إعدادات الكتلوك، مو هذي القائمة.
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
] as const

export const DEFAULT_NORTH_GOVERNORATES: string[] = [
  "نينوى",
  "أربيل",
  "السليمانية",
  "دهوك",
  "كركوك",
  "حلبجة",
]

export const BUSINESS_TYPE_OPTIONS: Array<{ value: "STATIONERY" | "TOYS" | "MIXED"; label: string }> = [
  { value: "STATIONERY", label: "قرطاسية" },
  { value: "TOYS", label: "ألعاب" },
  { value: "MIXED", label: "مختلط" },
]
