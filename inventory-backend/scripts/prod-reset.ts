/**
 * Standalone production maintenance script — runs directly against DATABASE_URL,
 * independent of the deployed API. Use when the backend deploy is lagging.
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL="postgresql://...railway..."; npx tsx scripts/prod-reset.ts list
 *   $env:DATABASE_URL="...";                        npx tsx scripts/prod-reset.ts wipe
 *   $env:DATABASE_URL="...";                        npx tsx scripts/prod-reset.ts merge
 *
 * Order: take a backup → list → wipe → merge.
 *
 * KEEPS: customers, users, settings, warehouses (branches), message_templates,
 *        catalog_categories, retail_categories/coupons/customers, counters,
 *        customer_tags, portal/access links, licensed_clients/payments.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const OPERATIONAL_TABLES = [
  "invoice_items", "invoices", "payment_vouchers", "quotation_items", "quotations",
  "coupon_redemptions", "coupons", "stock_movements", "transfer_items",
  "inventory_transfers", "stocktake_items", "stocktake_sessions", "order_preparations",
  "pending_approvals", "notifications", "retail_orders", "retail_catalog_items",
  "product_warehouse_stocks", "products", "audit_logs",
];

// Name the merged main warehouse and which branch stays untouched.
const MAIN_NAME = "المخزن الرئيسي";
const KEEP_NAME_MATCH = "شارع العباس";

async function list() {
  const branches = await prisma.branch.findMany({ orderBy: { name: "asc" } });
  console.log("\n── المخازن الحالية ──");
  for (const b of branches) {
    const customers = await prisma.customer.count({ where: { branchId: b.id, deletedAt: null } });
    console.log(`  • ${b.name}  (id=${b.id}, code=${b.code}, زبائن=${customers}, نشط=${b.isActive})`);
  }
  const counts = {
    products: await prisma.product.count(),
    invoices: await prisma.invoice.count(),
    vouchers: await prisma.paymentVoucher.count(),
    customers: await prisma.customer.count({ where: { deletedAt: null } }),
  };
  console.log("\n── العدّادات ──");
  console.log(`  مواد=${counts.products}  فواتير=${counts.invoices}  سندات=${counts.vouchers}  زبائن=${counts.customers}`);
}

async function wipe() {
  const tableList = OPERATIONAL_TABLES.map((t) => `"${t}"`).join(", ");
  console.log("⏳ مسح البيانات التشغيلية...");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
  console.log("✓ تم المسح. الزبائن وحسابات الدخول والإعدادات والمخازن محفوظة.");
  await list();
}

async function merge() {
  const branches = await prisma.branch.findMany();
  const keep = branches.filter((b) => b.name.includes(KEEP_NAME_MATCH));
  const others = branches.filter((b) => !b.name.includes(KEEP_NAME_MATCH));

  if (others.length === 0) {
    console.log("⚠ ما لقيت مخزن لدمجه (كلهم شارع العباس).");
    return;
  }

  // Prefer the branch currently set as the shop warehouse to become the main.
  const shopSetting = await prisma.setting.findUnique({ where: { key: "shopWarehouseId" } });
  const shopId = typeof shopSetting?.value === "string" ? shopSetting.value : "";
  const main = others.find((b) => b.id === shopId) ?? others[0];
  const toDelete = others.filter((b) => b.id !== main.id);

  console.log(`\n── خطة الدمج ──`);
  console.log(`  الرئيسي (يبقى ويُسمّى «${MAIN_NAME}»): ${main.name}`);
  console.log(`  يبقى كما هو: ${keep.map((b) => b.name).join("، ") || "(لا شيء)"}`);
  console.log(`  يُدمج ويُحذف: ${toDelete.map((b) => b.name).join("، ") || "(لا شيء)"}`);

  await prisma.$transaction(async (tx) => {
    let reassigned = 0;
    for (const b of toDelete) {
      const moved = await tx.customer.updateMany({ where: { branchId: b.id }, data: { branchId: main.id } });
      reassigned += moved.count;
      await tx.product.updateMany({ where: { branchId: b.id }, data: { branchId: main.id } });
      await tx.productWarehouseStock.deleteMany({ where: { warehouseId: b.id } });
    }
    if (shopSetting) {
      await tx.setting.update({ where: { key: "shopWarehouseId" }, data: { value: main.id } });
    }
    await tx.branch.update({ where: { id: main.id }, data: { name: MAIN_NAME, isActive: true } });
    for (const b of toDelete) {
      await tx.branch.delete({ where: { id: b.id } });
    }
    console.log(`✓ تم الدمج. أُعيد ربط ${reassigned} زبون على «${MAIN_NAME}».`);
  });

  await list();
}

async function main() {
  const cmd = process.argv[2];
  if (!process.env.DATABASE_URL) {
    console.error("✗ DATABASE_URL غير مضبوط.");
    process.exit(1);
  }
  switch (cmd) {
    case "list": await list(); break;
    case "wipe": await wipe(); break;
    case "merge": await merge(); break;
    default:
      console.log("الأوامر: list | wipe | merge");
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("✗ خطأ:", e);
  await prisma.$disconnect();
  process.exit(1);
});
