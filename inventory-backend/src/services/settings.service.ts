import { Prisma } from "@prisma/client";
import prisma from "../config/database";
import { syncWhatsAppSettings, generateVerifyToken } from "./whatsapp.service";
import { DEFAULT_NORTH_GOVERNORATES, DEFAULT_FREE_SHIPPING_THRESHOLD } from "../utils/deliveryRegion";
import { DEFAULT_ORDER_TIERS } from "../utils/orderTiers";

export interface AppSettings {
  debtReminderDays: number;
  inactiveCustomerDays: number;
  autoSendDebtReminder: boolean;
  autoSendInactiveMessage: boolean;
  storeName: string;
  storeLogo: string;
  storePhone: string;
  storeAddress: string;
  currency: string;
  // WhatsApp message templates. {{placeholder}} syntax.
  invoiceTemplate: string;
  invoiceDesign?: string;
  voucherTemplate: string;
  statementTemplate: string;
  // Meta-approved Cloud API template names (WhatsApp Manager → your business
  // account). Empty = not submitted/approved yet, sends fall back to the free
  // text templates above (silently rejected by Meta once the customer's 24h
  // reply window has closed). Once you create + get a template approved in
  // Meta, paste its exact name here and sends start using it automatically —
  // no further deploy needed. Cloud API only; ignored for other providers.
  // Reused for both the regular PDF invoice and the customer-safe "فاتورة
  // بالصور" send — both go out as a document (PDF) now, so one approved
  // template covers both.
  invoiceTemplateName?: string;
  voucherTemplateName?: string;
  statementTemplateName?: string;
  portalLinkTemplateName?: string;
  // Document-header template for the "إرسال PDF" statement send — lets the PDF
  // reach a customer even outside the 24h window. Empty = plain PDF send.
  statementPdfTemplateName?: string;
  // Cold-send template names — every one of these is a business-initiated
  // WhatsApp send the customer did not just message about, so it is almost
  // always outside Meta's 24h free-text window. Empty = falls back to the
  // existing free text (silently rejected by Cloud API past 24h, unchanged
  // behavior for tenants who never fill these in).
  otpTemplateName?: string;
  catalogAccessRequestedTemplateName?: string;
  catalogAccessApprovedTemplateName?: string;
  orderSubmittedTemplateName?: string;
  productArrivalTemplateName?: string;
  // Debt/inactive reminders are never auto-sent (see runDebtReminderJob /
  // runInactiveCustomerJob) — these only fire on the manual "send from shop
  // number" button, via POST /whatsapp/send-templated.
  debtReminderTemplateName?: string;
  inactiveCustomerTemplateName?: string;
  // Meta template names for the funnel's business-initiated sends. Every one
  // of these goes out when the customer has NOT just messaged us, so without
  // an approved template Meta silently drops it past the 24h window.
  // Empty = free text (works only inside the window).
  storefrontCredentialsTemplateName?: string;
  // Meta refuses to approve a Utility template that carries a login code, and
  // an Authentication template's body is fixed to the code alone. So the
  // credentials arrive as a pair: the utility welcome (name, store, username,
  // link) plus this authentication template carrying only the code. Both must
  // be filled in for the split to engage — otherwise sends stay on free text,
  // which still delivers everything inside the 24h window.
  storefrontLoginCodeTemplateName?: string;
  // «دعوة الحساب» — the cold marketing template that asks the shopper to
  // reply. Their reply opens Meta's 24h window, and the credentials then go
  // out as plain text with no template involved. This is the only compliant
  // route left: no template carrying a code is approvable on this account.
  storefrontInviteTemplateName?: string;
  storefrontInviteMessage?: string;
  storefrontInviteKeywords?: string[];
  // Body params for the invite template, in order. Each entry may contain
  // {{customerName}} / {{storeName}}, rendered per recipient. Empty by
  // default because a template with no variables is REJECTED outright when
  // parameters are sent with it — and the entry template most shops already
  // run is a plain paragraph with none.
  storefrontInviteTemplateParams?: string[];
  // «شريط الإعلان» — one line the shop writes for everyone browsing the
  // catalog: a running offer, a promo code, a holiday closure. Shown to
  // customers and visitors alike; empty text hides the bar entirely.
  catalogAnnouncementEnabled?: boolean;
  catalogAnnouncementText?: string;

  /* ── Storefront layout, in the merchant's hands ──────────────────────
     Everything below used to be fixed in the storefront's JSX. A shop that
     wants its banner above the badges, or no reviews at all, or its own
     wording on the login screen, should not need a deploy — so the page now
     reads its shape from here. Empty/undefined everywhere means "exactly the
     behaviour that shipped", which is what keeps existing tenants unchanged. */

  // Ordered sections with their on/off switch. Unknown keys are ignored and
  // known keys missing from the list fall back to their built-in position,
  // so adding a section in code never needs a data migration.
  catalogSections?: Array<{ key: string; enabled: boolean }>;

  // Per-key overrides for the storefront's visible wording. A missing or
  // blank value means the built-in Arabic text.
  catalogTexts?: Record<string, string>;

  // Categories the shop does not want on the storefront, and the order it
  // wants the rest in. Products keep their category either way — this is
  // display only, never a data change.
  catalogHiddenCategories?: string[];
  catalogCategoryOrder?: string[];

  // «مختاراتنا» — products the shop puts in a row of their own at the top.
  catalogFeaturedProductIds?: string[];

  // What the grid looks like before the shopper touches anything. They can
  // still change it for themselves; this is the default, not a lock.
  catalogDefaultView?: "grid" | "list";
  catalogDefaultPerRow?: number;
  catalogDefaultSort?: string;

  // Shop-wide switches for whole features.
  catalogReviewsEnabled?: boolean;
  catalogSuggestionsEnabled?: boolean;
  catalogTutorialEnabled?: boolean;

  // «عروض القائمة» — thresholds on the order subtotal that grant free
  // delivery, a percentage off, or both. Empty means the shop runs no offers
  // and the cart shows no progress bar at all.
  catalogOrderTiers?: Array<{ minTotal: number; freeDelivery: boolean; discountPercent: number }>;

  // A phone already in the shop's customer list gets wholesale prices the
  // moment it signs into the storefront, without asking. On by default: these
  // are people the shop quotes in person anyway, and making them file a
  // request is friction that only costs the merchant time.
  catalogAutoUnlockForCustomers?: boolean;

  // Whether an anonymous browser is asked for a phone BEFORE seeing anything.
  // On preserves the behaviour that shipped; off lets people look first and
  // identify at checkout, which is what a shop trading on impulse wants.
  catalogGuestPhoneGate?: boolean;

  // «كنت قريب» — a one-time nudge to a customer whose last order fell just
  // short of an offer. Off by default: it is a marketing send, and no shop
  // should start messaging its customers because of an upgrade.
  catalogTierNudgeEnabled?: boolean;
  /** How close counts, as a share of the rung they missed. */
  catalogTierNudgePercent?: number;
  catalogTierNudgeMessage?: string;
  catalogTierNudgeTemplateName?: string;
  catalogAccessApprovedV2TemplateName?: string;
  couponExpiryReminderTemplateName?: string;
  followUpNoReplyTemplateName?: string;
  followUpNoOrderTemplateName?: string;
  followUpInactiveTemplateName?: string;
  // UI preferences
  themePreset: "classic" | "iraqi" | "exclusive" | "bold" | "designer";
  // Backup
  backupWhatsappNumber?: string;
  // The warehouse that acts as المحل — sales deduct from here only. Falls back
  // to the oldest active warehouse when unset.
  shopWarehouseId?: string;
  // Public catalog / WhatsApp workflow
  catalogPublicUrl?: string;
  catalogAdminWhatsappNumber?: string;
  orderPreparationWhatsappNumbers?: string;
  // Dedicated number that receives staff approval requests (delete/cancel).
  // Falls back to storePhone when empty.
  adminApprovalWhatsappNumber?: string;
  // Daily summary
  autoSendDailySummary: boolean;
  dailySummaryWhatsappNumber?: string;
  dailySummaryHour: number;
  // WhatsApp provider + credentials (stored in DB so each tenant configures it
  // from the UI with no env/Railway access). env vars remain the fallback.
  //   manual   → wa.me links only, no silent background sending
  //   greenapi → send via Green API
  //   cloud    → send via Meta WhatsApp Cloud API
  //   web      → WhatsApp Web QR (Puppeteer) — legacy/auto default
  //   disabled → all WhatsApp sending blocked
  whatsappProvider?: "manual" | "greenapi" | "cloud" | "web" | "disabled";
  whatsappCloudToken?: string;
  whatsappCloudPhoneNumberId?: string;
  whatsappCloudBusinessAccountId?: string;
  whatsappCloudVerifyToken?: string;
  whatsappCloudAppSecret?: string;
  // Green API credentials (DB-configurable; env GREENAPI_* still works as fallback)
  greenApiInstanceId?: string;
  greenApiToken?: string;
  greenApiBaseUrl?: string;
  // ── Send channels (parallel, not either/or) ──────────────────────────────
  // "official"  → Meta Cloud API (shop number). Always the channel for every
  //               automatic/background send (templates, daily summary, OTP…).
  // "personal"  → Green API (owner's personal number). Manual button sends
  //               only — staff explicitly picks it per send. Bulk broadcast
  //               and campaigns never use it. Guarded by a daily limit to
  //               reduce ban risk on the personal number.
  // "web"       → wa.me link opened in the employee's browser; they hit send
  //               themselves. Pure client-side, no server involvement.
  personalChannelEnabled?: boolean;
  personalChannelDailyLimit?: number;
  webChannelEnabled?: boolean;
  // Preparation workers ("عمال التجهيز") — structured list for selective invoice
  // PDF sending. Stored as JSON in settings (no migration needed). Separate from
  // the legacy freeform orderPreparationWhatsappNumbers auto-broadcast.
  preparationWorkers?: Array<{ id: string; name: string; phone: string; active: boolean; notes?: string }>;
  // Telegram backup delivery
  telegramBotToken?: string;
  telegramChatId?: string;
  // «قناة تيليگرام» — public channel mirror of the wholesale catalog (see
  // telegram-channel.service). Separate bot from the backup bot above by
  // design — never reuse telegramBotToken here.
  telegramChannelEnabled?: boolean;
  telegramChannelBotToken?: string;
  telegramChannelChatId?: string;
  // «بوت الطلبات» (Phase 2 bot, ordering-suite extension) — configurable text
  // + anti-spam + daily-digest pin tracking. Never hardcode a tenant's real
  // address/hours here; each shop fills its own via Settings.
  telegramBotWelcomeMessage?: string;
  telegramBotStoreAddress?: string;
  telegramBotWorkingHours?: string;
  telegramBotContactPhone?: string;
  telegramBotBannedChatIds?: string[];
  telegramDigestLastMessageId?: number;
  telegramDigestLastMessageDate?: string;
  // Freshness: daily rotation republishes the N oldest channel posts so
  // long-standing in-stock products don't sink forever under newer ones.
  telegramRotationDailyCount?: number;
  // Featured-product daily pin — internal bookkeeping (excludes yesterday's
  // pick, tracks what to unpin), same treatment as the digest fields above.
  telegramFeaturedProductId?: string;
  telegramFeaturedLastMessageId?: number;
  telegramFeaturedLastDate?: string;
  // Wholesale catalog design (admin-configurable)
  catalogDesignPrimaryColor?: string;
  catalogDesignBgColor?: string;
  catalogDesignDefaultTheme?: "clean" | "warm" | "dark" | "vibrant";
  catalogDesignLogoUrl?: string;
  catalogDesignWelcomeMessage?: string;
  catalogDesignBannerEnabled?: boolean;
  catalogDesignBannerImages?: Array<{ url: string; title: string; order: number }>;
  // Wholesale catalog footer. Every field is optional and independent of the
  // storeName/storePhone/storeAddress identity settings on purpose: those are
  // the shop's internal/document details, while these are what the shop wants
  // shoppers to see. An empty field simply hides its row in the storefront,
  // so a tenant that fills in nothing gets no footer at all.
  catalogDesignFooterEnabled?: boolean;
  catalogDesignFooterAbout?: string;
  catalogDesignFooterPhone?: string;
  catalogDesignFooterWhatsapp?: string;
  catalogDesignFooterAddress?: string;
  catalogDesignFooterHours?: string;
  catalogDesignFooterInstagram?: string;
  catalogDesignFooterFacebook?: string;
  catalogDesignFooterTelegram?: string;
  catalogDesignFooterTiktok?: string;
  catalogDesignFooterDeliveryAreas?: string;
  catalogDesignFooterDeliveryTime?: string;
  catalogDesignFooterMinOrder?: string;
  catalogDesignFooterCashOnDelivery?: boolean;
  // Trust badges above the product grid. Each is off by default and carries
  // its own text: a shop that does not deliver must never be made to claim
  // it does just because the feature exists.
  catalogDesignTrust1Enabled?: boolean;
  catalogDesignTrust1Text?: string;
  catalogDesignTrust2Enabled?: boolean;
  catalogDesignTrust2Text?: string;
  catalogDesignTrust3Enabled?: boolean;
  catalogDesignTrust3Text?: string;
  // Below this many CARTONS in stock, the storefront shows a "only N left"
  // warning. Cartons, not pieces: this is a wholesale catalog and the old
  // piece-based threshold effectively never fired. 0 = never warn.
  catalogDesignLowStockCartons?: number;
  // Storefront login: whether a signed-in customer sees prices by default.
  // Per-customer exceptions live on Customer.catalogPricesHidden.
  catalogPricesVisibleByDefault?: boolean;
  // Whether a visitor with NO account sees prices. Separate from the switch
  // above on purpose: that one is the default for people the shop has on its
  // books, this one hands the wholesale price list to anyone holding the link.
  // Defaults to false — the behaviour every shop already had.
  catalogGuestPricesVisible?: boolean;
  // When true the catalog cannot be browsed without signing in at all.
  catalogRequireLogin?: boolean;
  // WhatsApp text sent to a customer with their storefront username + code.
  // Placeholders: customerName, storeName, username, code, link.
  storefrontCredentialsTemplate?: string;
  // Message a NEWLY APPROVED customer receives: the link plus the login
  // credentials they now need. Placeholders: customerName, storeName,
  // username, code, link, delivery (بند ٤ — the region-based delivery line;
  // resolves to "" if the customer has no province set yet), coupon (بند ٧ —
  // the auto-issued first-order welcome coupon line; resolves to "" if none
  // was issued, e.g. a re-approval of an existing customer). Empty = the
  // built-in default, which appends both lines automatically instead of
  // requiring the placeholders.
  catalogAccessApprovedTemplate?: string;
  // «توقف» — words that opt a number out of MARKETING (campaigns and
  // follow-ups). Empty = the built-in Arabic/English defaults. Invoices and
  // statements are never affected.
  marketingStopKeywords?: string[];
  marketingStopConfirmation?: string;
  // Wholesale catalog OTP re-verification gate. Defaults to true (current
  // behavior unchanged) — undefined/missing must also mean true so existing
  // tenants are never silently opened up. When false, a valid catalog link
  // grants access directly with no phone re-verification step.
  catalogRequireOtp?: boolean;
  // Global override: when true, every catalog viewer (guest AND registered
  // customers, regardless of their per-link stockFilter) only sees products
  // with at least one full carton in stock. Defaults to false so existing
  // per-customer stockFilter configuration is unaffected until opted in.
  catalogFullCartonOnly?: boolean;
  // Hide products that have no picture. The merchant's shop-wide default;
  // a shopper can override it for themselves from the storefront's appearance
  // sheet, so hiding them is a cleaner front page, not a wall the shopper
  // cannot see past. Defaults to false — nothing disappears until opted in.
  catalogHideNoImage?: boolean;
  // How many days a product counts as «وصلت هسه» on the storefront, measured
  // from when it was added. 0 turns the button off entirely.
  catalogNewArrivalDays?: number;
  // Tag names the shop wants as one-tap chips in the storefront's filter row,
  // beside «وصلت هسه». Matched against a product's category tags, type tags
  // or its category. Empty = no chips, which is what every shop starts with.
  catalogQuickTags?: string[];
  // «نقاط الولاء» — what one point is worth in dinars when redeemed, and how
  // long a point lives. Zero value turns redemption off without touching any
  // balance; zero days turns expiry off.
  loyaltyPointValue?: number;
  loyaltyExpiryDays?: number;
  // Wholesale catalog product-order rotation. "hourly" reshuffles the order for
  // all shoppers every hour, "daily" every day, "off" keeps the fixed
  // category/name order. Defaults to "hourly".
  catalogShuffleMode?: "hourly" | "daily" | "off";
  // Prospect auto-reply: when a prospect's reply contains ANY of these
  // trigger keywords, the configured message (with {{link}} substituted)
  // is sent back to them automatically.
  prospectGroupInviteLink?: string;
  prospectAutoReplyKeywords?: string[];
  prospectAutoReplyMessage?: string;
  prospectAutoReplyEnabled?: boolean;
  // WhatsApp customer-service bot: known customers whose message matches a
  // rule's keywords get an automatic reply — either real account data
  // (STATEMENT/BALANCE/CATALOG_LINK) or a fixed custom text (TEXT, owner-
  // editable, unlimited rows). Everyone else (prospects, unknown numbers, or
  // a known customer matching no rule) gets botUnknownMessage and lands in
  // the الرسائل الواردة inbox for a manual reply.
  whatsappBotEnabled?: boolean;
  botUnknownMessage?: string;
  botRules?: BotRule[];
  // Barcode label dimensions (mm) for the label/thermal printer.
  labelPieceWidthMm?: number;
  labelPieceHeightMm?: number;
  labelCartonWidthMm?: number;
  labelCartonHeightMm?: number;
  pieceLabelLayout?: "side-by-side" | "stacked" | "qr-only";
  pieceLabelQrPosition?: "left" | "right";
  pieceLabelShowName?: boolean;
  pieceLabelShowItemNumber?: boolean;
  pieceLabelShowCartonCount?: boolean;
  pieceLabelNameFontSize?: number;
  pieceLabelMetaFontSize?: number;
  pieceLabelPaddingMm?: number;
  // Same designer, for the carton sticker.
  cartonLabelLayout?: "side-by-side" | "stacked" | "qr-only";
  cartonLabelQrPosition?: "left" | "right";
  cartonLabelShowName?: boolean;
  cartonLabelShowItemNumber?: boolean;
  cartonLabelShowPcsPerCarton?: boolean;
  cartonLabelNameFontSize?: number;
  cartonLabelMetaFontSize?: number;
  cartonLabelPaddingMm?: number;
  // "جدولة الجرد الذكي" (scheduled smart cycle count) — fully independent
  // feature/settings from the manual "الجرد الدوري" stocktake page above.
  cycleCountEnabled?: boolean;
  cycleCountWarehouseId?: string;
  cycleCountIntervalDays?: number;
  cycleCountItemLimit?: number;
  cycleCountStrategy?: "RANDOM" | "HIGH_VALUE" | "FAST_MOVING" | "LOW_STOCK" | "LEAST_RECENTLY_COUNTED";
  cycleCountLastRunAt?: string;
  // «الديون الشخصية» — WhatsApp number that receives the daily due-date reminder.
  // Sent through the same tenant WhatsApp provider as everything else above.
  personalDebtReminderWhatsappNumber?: string;
  // "ابدأ فترة جديدة من اليوم" on the Profits report tab — a saved default
  // `from` date so a messy setup/trial period stops polluting the default
  // view. Purely a display default: never touches invoices, balances, or
  // stock, and picking an earlier date on the tab still shows full history.
  reportsProfitStartDate?: string;
  // بند ٤ — قمع الواتساب: أي محافظة تُصنَّف "الشمال" (توصيل حسب البضاعة).
  // أي محافظة غائبة عن هذي القائمة تُعتبر ضمن وسط/جنوب/غرب (توصيل مجاني فوق
  // catalogFreeShippingThreshold). قابلة للتعديل من تبويب إعدادات الكتلوك.
  catalogNorthGovernorates?: string[];
  catalogFreeShippingThreshold?: number;
  // بند ٧ — كوبون أول طلب: يُصدر تلقائياً عند الموافقة على زبون جديد.
  firstOrderCouponPercent?: number;
  firstOrderCouponDurationDays?: number;
  // بند ٨ — ثلاث متابعات تلقائية مستقلة، كل وحدة بمفتاح ومدة خاصين. مطفّاة
  // افتراضياً — إرسال تلقائي فعلي، ما يبدأ إلا بموافقة صريحة من المستخدم.
  followUpNoReplyEnabled?: boolean;
  followUpNoReplyDays?: number;
  followUpNoReplyMessage?: string;
  followUpRegisteredNoOrderEnabled?: boolean;
  followUpRegisteredNoOrderDays?: number;
  followUpRegisteredNoOrderMessage?: string;
  followUpInactiveEnabled?: boolean;
  followUpInactiveDays?: number;
  followUpInactiveMessage?: string;
  // ساعات العمل المشتركة للمتابعات الثلاث (تختلف عن ساعات كل حملة لحالها).
  followUpActiveStartHour?: number;
  followUpActiveEndHour?: number;
  // بند ٩ — حماية جودة رقم الواتساب (وقائي). آخر حالة معروفة تُقارَن بيها كل
  // قراءة جديدة (من الـwebhook أو الاستعلام اليومي) لاكتشاف أي هبوط. سقف
  // يومي إجمالي عبر كل الحملات معاً (مو لكل حملة لحالها) — طبقة أمان إضافية
  // فوق سقف كل حملة الخاص.
  whatsappLastQualityRating?: string;
  whatsappLastPhoneStatus?: string;
  whatsappQualityCheckedAt?: string;
  campaignGlobalDailyCap?: number;
}

export interface BotRule {
  id: string;
  keywords: string[];
  replyType: "STATEMENT" | "BALANCE" | "CATALOG_LINK" | "TEXT";
  replyText?: string;
  /** Built-in rules (STATEMENT/BALANCE/CATALOG_LINK) can't be deleted from the UI. */
  builtin?: boolean;
}

export const defaultSettings: AppSettings = {
  debtReminderDays: 14,
  inactiveCustomerDays: 30,
  autoSendDebtReminder: false,
  autoSendInactiveMessage: false,
  storeName: "Inventory Store",
  storeLogo: "",
  storePhone: "",
  storeAddress: "",
  currency: "IQD",
  invoiceTemplate:
    "مرحبا {{customerName}} تم اصدار فاتورة بيع رقم {{invoiceNumber}}\nبتاريخ {{date}}\nمبلغ الفاتورة {{total}} {{currency}}\nالمبلغ الواصل {{paid}} {{currency}}\nالمتبقي من الفاتورة {{remaining}} {{currency}}\nحسابك السابق قبل الفاتورة {{previousBalance}} {{currency}}\nالحساب النهائي {{finalBalance}} {{currency}}\nشكرا لتسوق من {{storeName}}\nنتمنى لك الرزق الوفير والكثير",
  invoiceDesign: "",
  voucherTemplate:
    "مرحباً {{customerName}}،\nاستلمنا منكم {{amount}} {{currency}} بسند رقم {{voucherNumber}} بتاريخ {{date}}.\nحسابكم السابق: {{previousBalance}} {{currency}}\nالحساب الحالي: {{currentBalance}} {{currency}}.\nشكراً، {{storeName}}.",
  statementTemplate:
    "كشف حساب {{customerName}} حتى {{date}}.\nالرصيد الحالي: {{currentBalance}} {{currency}}\nمن {{storeName}}.",
  // Matches the template names already live (pending Meta review as of
  // 2026-07-13) in WhatsApp Manager — kept as the default so tenants who
  // never open this setting still benefit once Meta approves them. Every
  // send still falls back to free text if the name doesn't match an
  // approved template, so this is safe for tenants without these templates.
  invoiceTemplateName: "invoice_notification_v3",
  voucherTemplateName: "voucher_receipt_notification_v2",
  statementTemplateName: "statement_notification",
  portalLinkTemplateName: "portal_link_notification",
  statementPdfTemplateName: "statement_pdf_notification",
  otpTemplateName: "",
  catalogAccessRequestedTemplateName: "catalog_access_requested",
  catalogAccessApprovedTemplateName: "catalog_access_approved",
  orderSubmittedTemplateName: "order_submitted_pending",
  productArrivalTemplateName: "",
  debtReminderTemplateName: "debt_reminder",
  inactiveCustomerTemplateName: "inactive_customer_reminder",
  // Blank on purpose: these six templates do not exist in any tenant's Meta
  // account yet. A non-empty default would make every send try a template
  // name Meta has never approved. The merchant pastes the real name from
  // WhatsApp Manager once approved, and sends switch over with no deploy.
  storefrontCredentialsTemplateName: "",
  storefrontLoginCodeTemplateName: "",
  storefrontInviteTemplateName: "",
  storefrontInviteMessage: "",
  storefrontInviteKeywords: [],
  storefrontInviteTemplateParams: [],
  catalogAnnouncementEnabled: false,
  catalogAnnouncementText: "",
  catalogSections: [],
  catalogTexts: {},
  catalogHiddenCategories: [],
  catalogCategoryOrder: [],
  catalogFeaturedProductIds: [],
  catalogDefaultView: "grid",
  catalogDefaultPerRow: 2,
  catalogDefaultSort: "",
  catalogReviewsEnabled: true,
  catalogSuggestionsEnabled: true,
  catalogTutorialEnabled: true,
  catalogOrderTiers: [...DEFAULT_ORDER_TIERS],
  catalogAutoUnlockForCustomers: true,
  catalogGuestPhoneGate: true,
  catalogTierNudgeEnabled: false,
  catalogTierNudgePercent: 20,
  catalogTierNudgeMessage: "",
  catalogTierNudgeTemplateName: "",
  catalogAccessApprovedV2TemplateName: "",
  couponExpiryReminderTemplateName: "",
  followUpNoReplyTemplateName: "",
  followUpNoOrderTemplateName: "",
  followUpInactiveTemplateName: "",
  themePreset: "classic",
  shopWarehouseId: "",
  // Intentionally blank — see utils/public-urls.ts. A tenant-specific default
  // here leaks one shop's customers into another shop's catalog.
  catalogPublicUrl: "",
  catalogAdminWhatsappNumber: "",
  catalogRequireOtp: true,
  catalogFullCartonOnly: false,
  catalogGuestPricesVisible: false,
  catalogHideNoImage: false,
  catalogNewArrivalDays: 10,
  catalogQuickTags: [],
  loyaltyPointValue: 5,
  loyaltyExpiryDays: 365,
  catalogShuffleMode: "hourly",
  catalogNorthGovernorates: [...DEFAULT_NORTH_GOVERNORATES],
  catalogFreeShippingThreshold: DEFAULT_FREE_SHIPPING_THRESHOLD,
  firstOrderCouponPercent: 5,
  firstOrderCouponDurationDays: 7,
  followUpNoReplyEnabled: false,
  followUpNoReplyDays: 3,
  followUpNoReplyMessage: "هلا 👋 شفنا ما رديت علينا، بس الفرصة لسه موجودة! تفضل شوف الكتلوك متى ما تريد:\n{{link}}",
  followUpRegisteredNoOrderEnabled: false,
  followUpRegisteredNoOrderDays: 5,
  followUpRegisteredNoOrderMessage: "هلا {{customerName}} 👋 لاحظنا ما كمّلت طلبك لسه. أكثر المواد المطلوبة عندنا:\n{{products}}\n\nادخل الكتلوك واختار اللي يعجبك:\n{{link}}",
  followUpInactiveEnabled: false,
  followUpInactiveDays: 30,
  followUpInactiveMessage: "هلا {{customerName}} 👋 اشتقنالك! آخر مرة طلبت هذي المواد:\n{{products}}\n\nتفضل شوف الجديد بالكتلوك:\n{{link}}",
  followUpActiveStartHour: 9,
  followUpActiveEndHour: 21,
  campaignGlobalDailyCap: 100,
  orderPreparationWhatsappNumbers: "",
  adminApprovalWhatsappNumber: "",
  autoSendDailySummary: false,
  dailySummaryWhatsappNumber: "",
  dailySummaryHour: 21,
  // Legacy "web" sentinel: falls through to env auto-detect in whatsapp.service
  // so tenants who set up Green/Cloud via env (and never picked a provider in
  // the UI) keep working exactly as before. New tenants that never open the
  // WhatsApp settings page effectively behave as "manual" (wa.me only), because
  // with no credentials + no ENABLE_WHATSAPP, silent sends are blocked anyway.
  whatsappProvider: "web",
  whatsappCloudToken: "",
  whatsappCloudPhoneNumberId: "",
  whatsappCloudBusinessAccountId: "",
  whatsappCloudVerifyToken: "",
  whatsappCloudAppSecret: "",
  greenApiInstanceId: "",
  greenApiToken: "",
  greenApiBaseUrl: "",
  personalChannelEnabled: false,
  personalChannelDailyLimit: 100,
  webChannelEnabled: true,
  preparationWorkers: [],
  prospectGroupInviteLink: "",
  prospectAutoReplyKeywords: ["تم", "نعم", "اوكي", "ok"],
  prospectAutoReplyMessage: "تمام 👍 هذا رابط كروبنا على الواتساب:\n{{link}}",
  prospectAutoReplyEnabled: false,
  whatsappBotEnabled: false,
  botUnknownMessage: "هلا 👋 استلمنا رسالتك، الإدارة رح ترد عليك قريباً.",
  botRules: [
    { id: "statement", builtin: true, replyType: "STATEMENT", keywords: ["كشف حساب", "كشف حسابي", "ابعث الكشف", "ارسل الكشف", "كشف"] },
    { id: "balance", builtin: true, replyType: "BALANCE", keywords: ["رصيدي", "كم رصيدي", "شكد رصيدي", "كم علي", "شحالي بالحساب"] },
    { id: "catalog", builtin: true, replyType: "CATALOG_LINK", keywords: ["ارسل لي الكتلوك", "ابعث الكتلوك", "الكاتلوك", "ابعثلي الكتالوج", "رابط الكتلوك"] },
    {
      id: "how-to-buy", builtin: false, replyType: "TEXT",
      keywords: ["كيف اشتري", "شلون اطلب", "كيف الطلب", "شلون اشتري", "طريقة الشراء"],
      replyText: "تكدر تطلب بسهولة 🛍️\nشوف منتجاتنا بالكاتلوج وابعثلنا الأصناف اللي تريدها، ونرتب الباقي وياك.",
    },
  ],
  labelPieceWidthMm: 50,
  labelPieceHeightMm: 25,
  labelCartonWidthMm: 100,
  labelCartonHeightMm: 100,
  pieceLabelLayout: "side-by-side",
  pieceLabelQrPosition: "left",
  pieceLabelShowName: true,
  pieceLabelShowItemNumber: true,
  pieceLabelShowCartonCount: true,
  pieceLabelNameFontSize: 14,
  pieceLabelMetaFontSize: 10,
  pieceLabelPaddingMm: 2,
  cartonLabelLayout: "stacked",
  cartonLabelQrPosition: "left",
  cartonLabelShowName: true,
  cartonLabelShowItemNumber: true,
  cartonLabelShowPcsPerCarton: true,
  cartonLabelNameFontSize: 20,
  cartonLabelMetaFontSize: 14,
  cartonLabelPaddingMm: 5,
  cycleCountEnabled: false,
  cycleCountWarehouseId: "",
  cycleCountIntervalDays: 7,
  cycleCountItemLimit: 20,
  cycleCountStrategy: "LEAST_RECENTLY_COUNTED",
  cycleCountLastRunAt: "",
  telegramChannelEnabled: false,
  telegramChannelBotToken: "",
  telegramChannelChatId: "",
  telegramBotWelcomeMessage: "",
  telegramBotStoreAddress: "",
  telegramBotWorkingHours: "",
  telegramBotContactPhone: "",
  telegramBotBannedChatIds: [],
  telegramDigestLastMessageId: 0,
  telegramDigestLastMessageDate: "",
  telegramRotationDailyCount: 12,
  telegramFeaturedProductId: "",
  telegramFeaturedLastMessageId: 0,
  telegramFeaturedLastDate: "",
  reportsProfitStartDate: "",
};

const OLD_INVOICE_TEMPLATE =
  "مرحباً {{customerName}}،\nفاتورتك رقم {{invoiceNumber}} بتاريخ {{date}}\nالمجموع: {{total}} {{currency}}\nالمدفوع: {{paid}} {{currency}}\nالباقي: {{remaining}} {{currency}}\nالحساب النهائي: {{finalBalance}} {{currency}}\nشكراً لتعاملكم مع {{storeName}}.";

export async function getSettings(): Promise<AppSettings> {
  const rows = await prisma.setting.findMany();
  const values = { ...defaultSettings } as Record<string, unknown>;

  for (const row of rows) {
    if (row.key.startsWith("_")) continue; // internal keys (e.g. _backupStatus) — not app settings
    values[row.key] = row.value;
  }

  // One-time migration: replace old invoice template with the new format
  if (values["invoiceTemplate"] === OLD_INVOICE_TEMPLATE) {
    values["invoiceTemplate"] = defaultSettings.invoiceTemplate;
    await prisma.setting.upsert({
      where: { key: "invoiceTemplate" },
      update: { value: defaultSettings.invoiceTemplate },
      create: { key: "invoiceTemplate", value: defaultSettings.invoiceTemplate },
    });
  }

  const settings = values as unknown as AppSettings;

  // Sync all WhatsApp provider + credentials into the WA service module
  syncWhatsAppSettings(settings);

  return settings;
}

export async function updateSettings(input: Partial<AppSettings>) {
  const entries = Object.entries(input).filter(
    // Keys can arrive as explicit undefined (e.g. zod's nullAsUndefined
    // preprocess in updateSettingsSchema) — "no change", never a DB write.
    ([, value]) => value !== undefined
  );

  // One transaction, not ~100 sequential round-trips. The settings page posts
  // the whole object on every save, so this was multiple seconds against
  // Railway — and a mid-loop failure left settings half-applied with no
  // rollback (e.g. whatsappProvider switched but its credentials not yet
  // written, so every send started failing).
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        create: { key, value: value as Prisma.InputJsonValue },
        update: { value: value as Prisma.InputJsonValue },
      })
    )
  );

  // getSettings() re-syncs WhatsApp credentials automatically
  const saved = await getSettings();

  // Auto-generate a Meta webhook verify token the first time Cloud API is the
  // chosen provider and none exists yet, so the webhook is usable immediately.
  if (saved.whatsappProvider === "cloud" && !saved.whatsappCloudVerifyToken?.trim()) {
    const token = generateVerifyToken();
    await prisma.setting.upsert({
      where: { key: "whatsappCloudVerifyToken" },
      create: { key: "whatsappCloudVerifyToken", value: token },
      update: { value: token },
    });
    return getSettings();
  }

  return saved;
}
