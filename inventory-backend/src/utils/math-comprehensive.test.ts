/**
 * اختبارات الرياضيات الشاملة - رصيد العملاء، الفواتير، السندات، المخزون
 * تغطي: إنشاء / تعديل / حذف / إلغاء لكل نوع
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCustomerBalance,
  calculateInvoiceFinancials,
  roundMoney,
  amountInPieces,
  invoiceBalanceSign,
} from "./financial";

// ═══════════════════════════════════════════════════════════════
// 1. roundMoney — تدوير المبالغ
// ═══════════════════════════════════════════════════════════════

test("[roundMoney] مبالغ عادية", () => {
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(roundMoney(12.345), 12.35);
  assert.equal(roundMoney(999.994), 999.99);
  assert.equal(roundMoney(999.995), 1000);
  assert.equal(roundMoney(0.005), 0.01);
  assert.equal(roundMoney(0.004), 0);
});

test("[roundMoney] أرقام سالبة", () => {
  assert.equal(roundMoney(-12.345), -12.34);
  assert.ok(roundMoney(-0.004) === 0); // -0 === 0 في JS
  // الأرقام السالبة تُدوَّر نحو الصفر (round half toward zero) لأن EPSILON موجب
  assert.equal(roundMoney(-1000.995), -1000.99);
});

test("[roundMoney] قيم غير محدودة وNaN", () => {
  assert.equal(roundMoney(Infinity), 0);
  assert.equal(roundMoney(-Infinity), 0);
  assert.equal(roundMoney(NaN), 0);
});

test("[roundMoney] مبالغ IQD كبيرة بدون انزلاق float", () => {
  assert.equal(roundMoney(1_000_000.005), 1_000_000.01);
  assert.equal(roundMoney(50_000_000), 50_000_000);
  assert.equal(roundMoney(123456.785), 123456.79);
  assert.equal(roundMoney(999999.995), 1_000_000);
});

// ═══════════════════════════════════════════════════════════════
// 2. invoiceBalanceSign — اتجاه الرصيد
// ═══════════════════════════════════════════════════════════════

test("[invoiceBalanceSign] بيع يرفع الرصيد (موجب)", () => {
  assert.equal(invoiceBalanceSign("SALE"), 1);
});

test("[invoiceBalanceSign] شراء ومرتجع يخفض الرصيد (سالب)", () => {
  assert.equal(invoiceBalanceSign("PURCHASE"), -1);
  assert.equal(invoiceBalanceSign("SALES_RETURN"), -1);
});

// ═══════════════════════════════════════════════════════════════
// 3. calculateInvoiceFinancials — حسابات الفاتورة
// ═══════════════════════════════════════════════════════════════

test("[فاتورة بيع] دفع جزئي — رصيد العميل يرتفع بالمتبقي", () => {
  const r = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 500_000,
    discount: 50_000,
    paidAmount: 200_000,
    previousBalance: 100_000,
  });
  assert.equal(r.subtotal, 500_000);
  assert.equal(r.discount, 50_000);
  assert.equal(r.totalAmount, 450_000);
  assert.equal(r.paidAmount, 200_000);
  assert.equal(r.remainingAmount, 250_000);
  assert.equal(r.balanceDelta, 250_000);
  assert.equal(r.finalBalance, 350_000); // 100k + 250k
  assert.equal(r.paymentType, "PARTIAL");
  assert.equal(r.overpayment, 0);
});

test("[فاتورة بيع] دفع كامل — لا يبقى شيء في الذمة", () => {
  const r = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 300_000,
    paidAmount: 300_000,
    previousBalance: 50_000,
  });
  assert.equal(r.remainingAmount, 0);
  assert.equal(r.paymentType, "CASH");
  assert.equal(r.finalBalance, 50_000); // previousBalance لم يتغير
  assert.equal(r.overpayment, 0);
});

test("[فاتورة بيع] دفع زائد — يُفصل كـoverpayment", () => {
  const r = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 100_000,
    paidAmount: 150_000,
    previousBalance: 0,
  });
  assert.equal(r.paidAmount, 100_000); // لا يتجاوز المجموع
  assert.equal(r.remainingAmount, 0);
  assert.equal(r.overpayment, 50_000);
  assert.equal(r.finalBalance, 0);
  assert.equal(r.paymentType, "CASH");
});

test("[فاتورة بيع] بدون دفع — CREDIT كامل", () => {
  const r = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 200_000,
    paidAmount: 0,
    previousBalance: 0,
  });
  assert.equal(r.paymentType, "CREDIT");
  assert.equal(r.remainingAmount, 200_000);
  assert.equal(r.finalBalance, 200_000);
});

test("[فاتورة بيع] مع ضريبة — تُضاف للمجموع", () => {
  const r = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 100_000,
    tax: 15_000,
    paidAmount: 115_000,
    previousBalance: 0,
  });
  assert.equal(r.totalAmount, 115_000);
  assert.equal(r.paidAmount, 115_000);
  assert.equal(r.remainingAmount, 0);
  assert.equal(r.paymentType, "CASH");
});

test("[فاتورة بيع] خصم أكبر من المجموع — يُجمَّد عند صفر", () => {
  const r = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 50_000,
    discount: 80_000,
    paidAmount: 0,
    previousBalance: 200_000,
  });
  assert.equal(r.remainingAmount, 0);
  assert.equal(r.paymentType, "CASH");
  assert.equal(r.finalBalance, 200_000);
});

test("[فاتورة شراء] يقلل رصيد العميل", () => {
  const r = calculateInvoiceFinancials({
    type: "PURCHASE",
    subtotal: 200_000,
    paidAmount: 50_000,
    previousBalance: 100_000,
  });
  assert.equal(r.remainingAmount, 150_000);
  assert.equal(r.balanceDelta, -150_000); // سالب لأنه شراء
  assert.equal(r.finalBalance, -50_000); // 100k - 150k
});

test("[مرتجع مبيعات] يقلل ما يدين به العميل", () => {
  const r = calculateInvoiceFinancials({
    type: "SALES_RETURN",
    subtotal: 80_000,
    paidAmount: 0,
    previousBalance: 200_000,
  });
  assert.equal(r.balanceDelta, -80_000);
  assert.equal(r.finalBalance, 120_000);
});

test("[فاتورة] مدخلات سالبة تُجمَّد عند صفر", () => {
  const r = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: -50_000,
    discount: -10_000,
    tax: -5_000,
    paidAmount: -1_000,
    previousBalance: 0,
  });
  assert.equal(r.subtotal, 0);
  assert.equal(r.discount, 0);
  assert.equal(r.tax, 0);
  assert.equal(r.paidAmount, 0);
  assert.equal(r.totalAmount, 0);
});

test("[فاتورة بيع] مبلغ صفر — CASH بدون تغيير رصيد", () => {
  const r = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 0,
    paidAmount: 0,
    previousBalance: 75_000,
  });
  assert.equal(r.totalAmount, 0);
  assert.equal(r.finalBalance, 75_000);
  assert.equal(r.paymentType, "CASH");
});

test("[فاتورة] مبالغ IQD ضخمة جداً — لا انزلاق", () => {
  const r = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 50_000_000,
    discount: 2_500_000,
    paidAmount: 20_000_000,
    previousBalance: 10_000_000,
  });
  assert.equal(r.totalAmount, 47_500_000);
  assert.equal(r.remainingAmount, 27_500_000);
  assert.equal(r.finalBalance, 37_500_000);
});

// ═══════════════════════════════════════════════════════════════
// 4. calculateCustomerBalance — رصيد العميل الكلي
// ═══════════════════════════════════════════════════════════════

test("[رصيد] عميل بدون معاملات", () => {
  assert.equal(calculateCustomerBalance({}), 0);
});

test("[رصيد] رصيد افتتاحي فقط", () => {
  assert.equal(calculateCustomerBalance({ openingBalance: 150_000 }), 150_000);
});

test("[رصيد] بيع آجل رافع الرصيد", () => {
  // openingBalance=0, sale remaining=300k → العميل يدين لنا 300k
  assert.equal(
    calculateCustomerBalance({ openingBalance: 0, salesRemaining: 300_000 }),
    300_000
  );
});

test("[رصيد] سند قبض يخفض ما يدين به العميل", () => {
  // sale remaining=300k, receipt=100k → يبقى 200k
  assert.equal(
    calculateCustomerBalance({
      openingBalance: 0,
      salesRemaining: 300_000,
      receipts: 100_000,
    }),
    200_000
  );
});

test("[رصيد] سند قبض كامل — يصفّر الذمة", () => {
  assert.equal(
    calculateCustomerBalance({
      openingBalance: 0,
      salesRemaining: 200_000,
      receipts: 200_000,
    }),
    0
  );
});

test("[رصيد] سند صرف يزيد المتبقي للعميل", () => {
  // نحن دفعنا للمورد → يقلل ما ندين به
  // في المعادلة: +payments
  assert.equal(
    calculateCustomerBalance({
      openingBalance: 0,
      purchasesRemaining: 200_000,
      payments: 50_000,
    }),
    -150_000 // -200k + 50k = -150k (نحن ندين للمورد)
  );
});

test("[رصيد] مورد — رصيد سالب يعني نحن المدينون", () => {
  const balance = calculateCustomerBalance({
    openingBalance: 0,
    purchasesRemaining: 500_000,
    payments: 100_000,
  });
  assert.equal(balance, -400_000);
});

test("[رصيد] معادلة كاملة: رصيد + بيع + شراء + قبض + صرف", () => {
  // openingBalance=20k, sales=300k, purchases=40k, salesReturns=30k,
  // receipts=230k, payments=10k
  // = 20k + 300k - 40k - 30k - 230k + 10k = 30k
  const balance = calculateCustomerBalance({
    openingBalance: 20_000,
    salesRemaining: 300_000,
    purchasesRemaining: 40_000,
    salesReturnsRemaining: 30_000,
    receipts: 230_000,
    payments: 10_000,
  });
  assert.equal(balance, 30_000);
});

test("[رصيد] مرتجع مبيعات يقلل دين العميل", () => {
  const balance = calculateCustomerBalance({
    openingBalance: 0,
    salesRemaining: 400_000,
    salesReturnsRemaining: 150_000,
  });
  assert.equal(balance, 250_000);
});

test("[رصيد] قبوض تتجاوز المبيعات — رصيد سالب (نحن مدينون)", () => {
  const balance = calculateCustomerBalance({
    openingBalance: 0,
    salesRemaining: 100_000,
    receipts: 150_000,
  });
  assert.equal(balance, -50_000);
});

test("[رصيد] رصيد افتتاحي سالب (نحن مدينون للمورد من البداية)", () => {
  const balance = calculateCustomerBalance({
    openingBalance: -100_000,
    salesRemaining: 50_000,
  });
  assert.equal(balance, -50_000);
});

// ═══════════════════════════════════════════════════════════════
// 5. سيناريوهات دورة حياة كاملة — تسلسل معاملات
// ═══════════════════════════════════════════════════════════════

test("[سيناريو] دورة حياة عميل كاملة: بيع → قبض → مرتجع", () => {
  // خطوة 1: فاتورة بيع 500k، دفع 100k
  const invoice1 = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 500_000,
    paidAmount: 100_000,
    previousBalance: 0,
  });
  assert.equal(invoice1.remainingAmount, 400_000);
  assert.equal(invoice1.finalBalance, 400_000);

  // خطوة 2: سند قبض 200k
  const afterReceipt = calculateCustomerBalance({
    openingBalance: 0,
    salesRemaining: 400_000,
    receipts: 200_000,
  });
  assert.equal(afterReceipt, 200_000);

  // خطوة 3: مرتجع 100k
  const afterReturn = calculateCustomerBalance({
    openingBalance: 0,
    salesRemaining: 400_000,
    salesReturnsRemaining: 100_000,
    receipts: 200_000,
  });
  assert.equal(afterReturn, 100_000);
});

test("[سيناريو] حذف سند قبض — الرصيد يعود لما كان", () => {
  // قبل السند: رصيد = 500k
  const beforeVoucher = calculateCustomerBalance({
    openingBalance: 0,
    salesRemaining: 500_000,
    receipts: 0,
  });
  assert.equal(beforeVoucher, 500_000);

  // بعد إنشاء سند قبض 200k: رصيد = 300k
  const afterCreate = calculateCustomerBalance({
    openingBalance: 0,
    salesRemaining: 500_000,
    receipts: 200_000,
  });
  assert.equal(afterCreate, 300_000);

  // بعد حذف السند (receipts يعود 0): الرصيد يجب أن يعود 500k
  const afterDelete = calculateCustomerBalance({
    openingBalance: 0,
    salesRemaining: 500_000,
    receipts: 0, // السند المحذوف لا يُحتسب
  });
  assert.equal(afterDelete, 500_000);
  assert.equal(afterDelete, beforeVoucher); // ← يجب أن يساوي ما قبل السند
});

test("[سيناريو] إلغاء سند قبض — نفس نتيجة الحذف", () => {
  const withVoucher = calculateCustomerBalance({
    openingBalance: 0,
    salesRemaining: 300_000,
    receipts: 150_000,
  });
  assert.equal(withVoucher, 150_000);

  // بعد الإلغاء (لا يُحتسب السند)
  const afterCancel = calculateCustomerBalance({
    openingBalance: 0,
    salesRemaining: 300_000,
    receipts: 0,
  });
  assert.equal(afterCancel, 300_000);
});

test("[سيناريو] سند صرف يُحذف — الرصيد يعود", () => {
  // قبل سند الصرف: مورد رصيد = -300k
  const before = calculateCustomerBalance({
    openingBalance: 0,
    purchasesRemaining: 300_000,
    payments: 0,
  });
  assert.equal(before, -300_000);

  // بعد سند صرف 100k: رصيد = -200k
  const afterPayment = calculateCustomerBalance({
    openingBalance: 0,
    purchasesRemaining: 300_000,
    payments: 100_000,
  });
  assert.equal(afterPayment, -200_000);

  // بعد حذف سند الصرف: يعود -300k
  const afterDeletePayment = calculateCustomerBalance({
    openingBalance: 0,
    purchasesRemaining: 300_000,
    payments: 0,
  });
  assert.equal(afterDeletePayment, -300_000);
  assert.equal(afterDeletePayment, before);
});

test("[سيناريو] إلغاء فاتورة بيع — الرصيد يعود للحالة السابقة", () => {
  // رصيد سابق = 100k
  const beforeInvoice = 100_000;

  // فاتورة بيع 200k بدون دفع
  const invoice = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 200_000,
    paidAmount: 0,
    previousBalance: beforeInvoice,
  });
  assert.equal(invoice.finalBalance, 300_000);

  // بعد إلغاء الفاتورة: remainingAmount لا يُحتسب
  const afterCancel = calculateCustomerBalance({
    openingBalance: 100_000,
    salesRemaining: 0, // الفاتورة الملغاة لا تُحتسب
    receipts: 0,
  });
  assert.equal(afterCancel, 100_000); // يعود للرصيد السابق
});

test("[سيناريو] عميل مع فواتير متعددة — مجموع صحيح", () => {
  // فاتورة 1: 300k، دفع 100k → remaining = 200k
  const inv1 = calculateInvoiceFinancials({
    type: "SALE", subtotal: 300_000, paidAmount: 100_000, previousBalance: 0,
  });
  // فاتورة 2: 500k، دفع 0 → remaining = 500k
  const inv2 = calculateInvoiceFinancials({
    type: "SALE", subtotal: 500_000, paidAmount: 0, previousBalance: inv1.finalBalance,
  });
  // فاتورة 3: بيع 150k، دفع كامل → remaining = 0
  const inv3 = calculateInvoiceFinancials({
    type: "SALE", subtotal: 150_000, paidAmount: 150_000, previousBalance: inv2.finalBalance,
  });

  assert.equal(inv1.remainingAmount, 200_000);
  assert.equal(inv2.remainingAmount, 500_000);
  assert.equal(inv3.remainingAmount, 0);

  // الرصيد الكلي بعد كل الفواتير
  const totalBalance = calculateCustomerBalance({
    openingBalance: 0,
    salesRemaining: inv1.remainingAmount + inv2.remainingAmount + inv3.remainingAmount,
    receipts: 0,
  });
  assert.equal(totalBalance, 700_000);
});

test("[سيناريو] تعديل فاتورة — الرصيد القديم يُحذف والجديد يُضاف", () => {
  // الفاتورة الأصلية: 400k، دفع 100k → remaining 300k
  const originalRemaining = calculateInvoiceFinancials({
    type: "SALE", subtotal: 400_000, paidAmount: 100_000, previousBalance: 0,
  }).remainingAmount;
  assert.equal(originalRemaining, 300_000);

  // بعد التعديل: 600k، دفع 200k → remaining 400k
  const editedRemaining = calculateInvoiceFinancials({
    type: "SALE", subtotal: 600_000, paidAmount: 200_000, previousBalance: 0,
  }).remainingAmount;
  assert.equal(editedRemaining, 400_000);

  // الرصيد يعكس الفاتورة المعدَّلة فقط
  const balanceAfterEdit = calculateCustomerBalance({
    openingBalance: 0,
    salesRemaining: editedRemaining,
  });
  assert.equal(balanceAfterEdit, 400_000);
});

// ═══════════════════════════════════════════════════════════════
// 6. amountInPieces — تحويل وحدات المخزون
// ═══════════════════════════════════════════════════════════════

test("[مخزون] قطعة — مباشر", () => {
  assert.equal(amountInPieces("PIECE", 5, 24), 5);
  assert.equal(amountInPieces("PIECE", 1, 1), 1);
  assert.equal(amountInPieces("PIECE", 0, 100), 0);
});

test("[مخزون] كرتون × عدد في الكرتون", () => {
  assert.equal(amountInPieces("CARTON", 2, 24), 48);
  assert.equal(amountInPieces("CARTON", 1, 12), 12);
  assert.equal(amountInPieces("CARTON", 5, 6), 30);
  assert.equal(amountInPieces("CARTON", 0, 24), 0);
  assert.equal(amountInPieces("CARTON", 1, 1), 1);
});

test("[مخزون] دزينة = 12 دائماً بغض النظر عن pcsPerCarton", () => {
  assert.equal(amountInPieces("DOZEN", 1, 24), 12);
  assert.equal(amountInPieces("DOZEN", 3, 999), 36);
  assert.equal(amountInPieces("DOZEN", 2, 1), 24);
  assert.equal(amountInPieces("DOZEN", 0, 12), 0);
});

test("[مخزون] سيناريو مخزون: بيع يخفض — إلغاء يعيد", () => {
  let stock = 100;
  const saleQty = amountInPieces("CARTON", 3, 12); // 36 قطعة
  stock -= saleQty;
  assert.equal(stock, 64);

  // إلغاء البيع — يُعاد المخزون
  stock += saleQty;
  assert.equal(stock, 100);
});

test("[مخزون] شراء يرفع المخزون — إلغاء يخفضه", () => {
  let stock = 50;
  const purchaseQty = amountInPieces("DOZEN", 5, 0); // 60 قطعة
  stock += purchaseQty;
  assert.equal(stock, 110);

  stock -= purchaseQty;
  assert.equal(stock, 50);
});

// ═══════════════════════════════════════════════════════════════
// 7. حالات حدية وأرقام متطرفة
// ═══════════════════════════════════════════════════════════════

test("[حد] فاتورة بيع بخصم 100% — CASH بلا متبقي", () => {
  const r = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 200_000,
    discount: 200_000,
    paidAmount: 0,
    previousBalance: 0,
  });
  assert.equal(r.totalAmount, 0);
  assert.equal(r.remainingAmount, 0);
  assert.equal(r.paymentType, "CASH");
  assert.equal(r.finalBalance, 0);
});

test("[حد] رصيد افتتاحي كبير مع سندات متعددة", () => {
  const balance = calculateCustomerBalance({
    openingBalance: 10_000_000,
    salesRemaining: 5_000_000,
    purchasesRemaining: 2_000_000,
    receipts: 8_000_000,
    payments: 1_000_000,
  });
  // 10M + 5M - 2M - 8M + 1M = 6M
  assert.equal(balance, 6_000_000);
});

test("[حد] تصفير كامل — جميع المعاملات تُلغى", () => {
  // عميل مع معاملات
  const active = calculateCustomerBalance({
    openingBalance: 50_000,
    salesRemaining: 300_000,
    receipts: 200_000,
  });
  assert.equal(active, 150_000);

  // بعد حذف كل شيء وإلغاؤه — يعود للرصيد الافتتاحي فقط
  const afterReset = calculateCustomerBalance({
    openingBalance: 50_000,
    salesRemaining: 0,
    receipts: 0,
  });
  assert.equal(afterReset, 50_000);
});

test("[حد] فاتورتا بيع وشراء للعميل نفسه — صافي الرصيد", () => {
  // بيع 400k غير مدفوع
  const sale = calculateInvoiceFinancials({
    type: "SALE", subtotal: 400_000, paidAmount: 0, previousBalance: 0,
  });
  // شراء 250k غير مدفوع
  const purchase = calculateInvoiceFinancials({
    type: "PURCHASE", subtotal: 250_000, paidAmount: 0, previousBalance: sale.finalBalance,
  });

  assert.equal(sale.remainingAmount, 400_000);
  assert.equal(purchase.remainingAmount, 250_000);

  const netBalance = calculateCustomerBalance({
    openingBalance: 0,
    salesRemaining: 400_000,
    purchasesRemaining: 250_000,
  });
  assert.equal(netBalance, 150_000); // العميل لا يزال مدين لنا بـ 150k صافياً
});

test("[حد] عملية بيع مع ضريبة وخصم معاً", () => {
  // subtotal=1M, discount=100k, tax=90k → total = 990k
  const r = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 1_000_000,
    discount: 100_000,
    tax: 90_000,
    paidAmount: 500_000,
    previousBalance: 200_000,
  });
  assert.equal(r.totalAmount, 990_000);
  assert.equal(r.paidAmount, 500_000);
  assert.equal(r.remainingAmount, 490_000);
  assert.equal(r.finalBalance, 690_000); // 200k + 490k
  assert.equal(r.paymentType, "PARTIAL");
});

// ═══════════════════════════════════════════════════════════════
// 8. التحقق من اتساق فلاتر قاعدة البيانات (منطق الاستثناء)
// ═══════════════════════════════════════════════════════════════

test("[فلاتر DB] سند محذوف (archivedAt مضبوط) لا يُحتسب في الرصيد", () => {
  // نحاكي ما تعيده aggregate مع الفلاتر الصحيحة:
  // archivedAt: null, cancelledAt: null
  const vouchersInDb = [
    { id: "v1", amount: 100_000, cancelledAt: null, archivedAt: null },         // نشط
    { id: "v2", amount: 200_000, cancelledAt: new Date(), archivedAt: null },   // ملغى
    { id: "v3", amount: 300_000, cancelledAt: new Date(), archivedAt: new Date() }, // محذوف
    { id: "v4", amount: 50_000, cancelledAt: null, archivedAt: new Date() },    // مؤرشف بدون إلغاء!
  ];

  // الفلتر الصحيح: archivedAt IS NULL AND cancelledAt IS NULL
  const correctFilter = vouchersInDb.filter(
    (v) => v.cancelledAt === null && v.archivedAt === null
  );
  const correctSum = correctFilter.reduce((s, v) => s + v.amount, 0);
  assert.equal(correctFilter.length, 1); // v1 فقط
  assert.equal(correctSum, 100_000);

  // الفلتر المعطوب: cancelledAt IS NULL فقط (بدون archivedAt)
  const buggyFilter = vouchersInDb.filter((v) => v.cancelledAt === null);
  const buggySum = buggyFilter.reduce((s, v) => s + v.amount, 0);
  assert.equal(buggyFilter.length, 2); // v1 + v4 (المؤرشف بدون إلغاء)
  assert.equal(buggySum, 150_000); // 50k زيادة خاطئة!

  // يُثبت أن الفلتر الصحيح يختلف عن المعطوب
  assert.notEqual(correctSum, buggySum);
});

test("[فلاتر DB] فاتورة محذوفة تصبح CANCELLED قبل الأرشفة فلا تُحتسب", () => {
  const invoicesInDb = [
    { id: "i1", status: "ACTIVE", remainingAmount: 300_000, archivedAt: null },
    { id: "i2", status: "CANCELLED", remainingAmount: 200_000, archivedAt: null }, // ملغاة
    { id: "i3", status: "CANCELLED", remainingAmount: 150_000, archivedAt: new Date() }, // محذوفة
  ];

  // فلتر الفواتير الفعالة: status = ACTIVE
  const activeInvoices = invoicesInDb.filter((i) => i.status === "ACTIVE");
  const activeSum = activeInvoices.reduce((s, i) => s + i.remainingAmount, 0);
  assert.equal(activeSum, 300_000); // i1 فقط
});

test("[فلاتر DB] استخراج الرصيد الصحيح بعد عدة عمليات", () => {
  // محاكاة حالة قاعدة بيانات فيها:
  // - فاتورتا بيع نشطتان: 400k, 600k
  // - فاتورة ملغاة: 200k (لا تُحتسب)
  // - سند قبض نشط: 300k
  // - سند قبض ملغى: 100k (لا يُحتسب)
  // - سند قبض محذوف: 50k (لا يُحتسب)

  const salesRemaining = 400_000 + 600_000; // 1M من الفواتير النشطة
  const receipts = 300_000; // من السندات النشطة فقط

  const balance = calculateCustomerBalance({
    openingBalance: 0,
    salesRemaining,
    receipts,
  });

  // 1M - 300k = 700k
  assert.equal(balance, 700_000);

  // لو أُضيف سند ملغى/محذوف بالخطأ
  const wrongBalance = calculateCustomerBalance({
    openingBalance: 0,
    salesRemaining,
    receipts: receipts + 100_000 + 50_000, // سندات ملغاة/محذوفة مضمّنة بالخطأ
  });
  assert.equal(wrongBalance, 550_000); // خطأ: 150k إضافية
  assert.notEqual(wrongBalance, balance);
});
