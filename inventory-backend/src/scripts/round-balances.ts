/**
 * تنظيف الكسور من أرصدة الزبائن — مرة واحدة.
 *
 * القاعدة (قرار صاحب المحل):
 *   • رصيد أقل من دينار بالمطلق (مثل ٠٫٦) → صفر. هذي مو ديون، هذي بقايا
 *     تقريب ما تنحل أبداً لأن السندات ما تقبل كسوراً أصلاً.
 *   • أي رصيد ثاني فيه كسر → أقرب دينار.
 *
 * يشتغل بوضع العرض افتراضياً ويطبع تقريراً قبل/بعد. التعديل الفعلي يحتاج
 * ‎--apply صراحةً، ويُسجَّل بسجل التدقيق حتى يبقى أثر لمن يسأل بعد سنة
 * «منو غيّر رصيد هذا الزبون».
 *
 *   npx tsx src/scripts/round-balances.ts            # عرض فقط
 *   npx tsx src/scripts/round-balances.ts --apply    # تنفيذ
 */

import prisma from "../config/database";

const APPLY = process.argv.includes("--apply");

/** الرصيد الجديد حسب القاعدة أعلاه. */
export function roundedBalance(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) < 1) return 0;
  return Math.round(value);
}

async function main() {
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, phone: true, currentBalance: true },
  });

  const changes = customers
    .map((customer) => {
      const before = Number(customer.currentBalance);
      const after = roundedBalance(before);
      return { ...customer, before, after, delta: after - before };
    })
    .filter((row) => row.before !== row.after);

  if (changes.length === 0) {
    console.log("ماكو أرصدة مكسورة — كلشي بالدينار الصحيح.");
    return;
  }

  const zeroed = changes.filter((row) => row.after === 0 && row.before !== 0);
  const totalDelta = changes.reduce((sum, row) => sum + row.delta, 0);

  console.log(`زبائن رح تتغير أرصدتهم: ${changes.length}`);
  console.log(`منهم أرصدة أقل من دينار رح تتصفّر: ${zeroed.length}`);
  console.log(`مجموع الفرق: ${totalDelta.toFixed(2)} دينار\n`);
  for (const row of changes.slice(0, 60)) {
    console.log(`  ${row.name} (${row.phone}): ${row.before} → ${row.after}`);
  }
  if (changes.length > 60) console.log(`  … و${changes.length - 60} غيرهم`);

  if (!APPLY) {
    console.log("\nعرض فقط. للتنفيذ ضيف --apply");
    return;
  }

  // دفعة وحدة: إما تنجح كلها أو ما تنجح — رصيد نصف معدّل أسوأ من رصيد مكسور.
  await prisma.$transaction([
    ...changes.map((row) =>
      prisma.customer.update({ where: { id: row.id }, data: { currentBalance: row.after } }),
    ),
    prisma.auditLog.create({
      data: {
        action: "BALANCES_ROUNDED_TO_DINAR",
        entity: "Customer",
        recordId: "bulk",
        // العيّنة محدودة بعشرين صفاً: السجل للتوثيق لا للتخزين، والتقرير
        // الكامل يطلع من تشغيل السكربت بوضع العرض.
        before: changes.slice(0, 20).map((row) => ({ id: row.id, name: row.name, balance: row.before })),
        after: changes.slice(0, 20).map((row) => ({ id: row.id, name: row.name, balance: row.after })),
        metadata: {
          rule: "abs(balance) < 1 → 0، وغيره أقرب دينار",
          customersChanged: changes.length,
          zeroed: zeroed.length,
          totalDelta,
        },
      },
    }),
  ]);

  console.log(`\n✓ انعدّل ${changes.length} رصيد، وانسجّلت العملية بسجل التدقيق.`);
}

main()
  .catch((error) => {
    console.error("فشل:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
