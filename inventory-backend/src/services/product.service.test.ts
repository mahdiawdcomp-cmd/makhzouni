/**
 * product.service — comprehensive unit tests
 *
 * Covers the critical warehouse-distribution flows introduced to fix the
 * "edit product total → stock added to wrong warehouse" bug:
 *
 *  • updateProduct  — with warehouseDistribution (edit mode)
 *  • updateProduct  — fallback single-warehouse path
 *  • createProduct  — with / without distribution
 *  • getProductById — shopStock + currentStock serialization + not-found errors
 *  • deleteProduct  — soft-delete + not-found guard
 *
 * No database connection required — all Prisma calls are intercepted via
 * mock.module(), matching the pattern in accounting-safe-delete.test.ts.
 */

import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// ── Spy factory ──────────────────────────────────────────────────────────────
type Call = { args: any[] };
function makeSpy() {
  const calls: Call[] = [];
  const fn = async (...args: any[]) => {
    calls.push({ args });
  };
  (fn as any).calls = calls;
  return fn as ((...a: any[]) => Promise<void>) & { calls: Call[] };
}

// ── Warehouse / product constants ────────────────────────────────────────────
const SHOP_ID = "wh-shop";
const ABB_ID  = "wh-abb";
const PROD_ID = "prod-1";

// ── Mutable state reset in beforeEach ────────────────────────────────────────
let productStore: any;
let branches: Map<string, any>;

// Spies are module-level so the stable mock wrappers below can delegate to
// the freshly-created instances that beforeEach installs.
let upsertStockSpy: ReturnType<typeof makeSpy>;
let syncStockSpy:   ReturnType<typeof makeSpy>;

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeActiveBranches(): Map<string, any> {
  return new Map([
    [SHOP_ID, { id: SHOP_ID, name: "المحل",         code: "SHOP", isActive: true, createdAt: new Date("2024-01-01") }],
    [ABB_ID,  { id: ABB_ID,  name: "مخزن العباسية", code: "ABB",  isActive: true, createdAt: new Date("2024-01-02") }],
  ]);
}

function makeFakeProduct(override: Record<string, any> = {}) {
  return {
    id: PROD_ID,
    itemNumber: "AB0001",
    name: "منتج تجريبي",
    qrCode: "PCS-abc",
    cartonQrCode: "CTN-abc",
    imageUrl: null,
    category: "عام",
    categoryTags: [],
    typeTags: [],
    isNewArrival: false,
    isOffer: false,
    oldPrice: null,
    openingBalancePcs: 20,
    cartonsAvailable: 0,
    pcsPerCarton: 1,
    purchasePrice: 5000,
    salePrice: 7000,
    retailPrice: 8000,
    costPrice: 4500,
    expiryDate: null,
    minStock: 10,
    storageLocation: null,
    branchId: SHOP_ID,
    createdBy: "user-admin",
    deletedAt: null,
    warehouseStocks: [
      { warehouseId: SHOP_ID, quantityPieces: 50, warehouse: { id: SHOP_ID, name: "المحل",         code: "SHOP", isActive: true } },
      { warehouseId: ABB_ID,  quantityPieces: 70, warehouse: { id: ABB_ID,  name: "مخزن العباسية", code: "ABB",  isActive: true } },
    ],
    branch: { id: SHOP_ID, name: "المحل", code: "SHOP" },
    ...override,
  };
}

// ── Fake transaction client ───────────────────────────────────────────────────
let tx: any;

function makeTx() {
  return {
    product: {
      /** Used by getProductById (findFirst with where.deletedAt: null) */
      findFirst: async ({ where }: any) => {
        if (!productStore) return null;
        const idMatch = !where?.id || productStore.id === where.id;
        const notDeleted = !productStore.deletedAt;
        return idMatch && notDeleted ? { ...productStore } : null;
      },
      /** Clash check inside nextItemNumber */
      findUnique: async ({ where }: any) => {
        if (where?.itemNumber) return null; // no item-number clash → proceed
        if (where?.id && productStore?.id === where.id) return { ...productStore };
        return null;
      },
      /** Final include-rich fetch after create / update */
      findUniqueOrThrow: async () => ({
        ...productStore,
        warehouseStocks: productStore?.warehouseStocks ?? [],
        branch: productStore?.branch ?? null,
      }),
      update: async ({ where, data }: any) => {
        if (!productStore || productStore.id !== where.id) {
          throw new Error(`[fake] product ${where.id} not found`);
        }
        Object.assign(productStore, data);
        return { ...productStore };
      },
      create: async ({ data }: any) => {
        productStore = {
          id: PROD_ID,
          deletedAt: null,
          warehouseStocks: [],
          branch: null,
          ...data,
        };
        return { ...productStore };
      },
    },
    branch: {
      /** Distribution validation: return only known + active warehouses */
      findMany: async ({ where }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        return ids
          .map((id) => branches.get(id))
          .filter(Boolean)
          .filter((b: any) => where?.isActive === undefined || b.isActive === where.isActive);
      },
      /** resolveWarehouseId fallback (called by the real impl when no preferredId) */
      findFirst: async ({ where }: any) => {
        for (const [, b] of branches) {
          if (where?.isActive !== undefined && b.isActive !== where.isActive) continue;
          if (where?.id && b.id !== where.id) continue;
          if (where?.name?.contains && !b.name.includes(where.name.contains)) continue;
          return b;
        }
        return null;
      },
      create: async ({ data }: any) => ({ id: "auto-wh", ...data }),
    },
    productWarehouseStock: {
      count: async () => productStore?.warehouseStocks?.length ?? 0,
      upsert: async ({ create }: any) => create,
      aggregate: async () => ({ _sum: { quantityPieces: 120 } }),
    },
    stockMovement: {
      create: async ({ data }: any) => ({ id: "mv", ...data }),
      findMany: async () => [],
    },
    counter: {
      upsert: async () => ({ key: "product_item_number", value: 1 }),
    },
    $queryRaw: async () => [],
  };
}

// ── Fake prisma (delegates to tx via getters so beforeEach replacements land) ─
const fakePrisma = {
  $transaction: async (cb: any) => cb(tx),
  get product()               { return tx.product; },
  get branch()                { return tx.branch; },
  get productWarehouseStock() { return tx.productWarehouseStock; },
  get counter()               { return tx.counter; },
  $queryRaw: async () => [],
};

// ── Module mocks — MUST be registered before the dynamic import() below ───────
mock.module("../config/database", { exports: { default: fakePrisma } });

// Stable wrappers so that the mock can delegate to whichever spy
// beforeEach just installed, without re-registering the mock every test.
mock.module("./warehouse-stock.service", {
  exports: {
    resolveShopWarehouseId:   async ()                       => SHOP_ID,
    resolveWarehouseId:       async (_: any, id?: string | null) => id ?? SHOP_ID,
    ensureLegacyWarehouseStock: async ()                     => {},
    upsertWarehouseStock:     async (...a: any[])            => upsertStockSpy(...a),
    syncProductTotalStock:    async (...a: any[])            => syncStockSpy(...a),
    normalizeProductStock:    (total: number, pcs: number)   => ({
      openingBalancePcs: total % pcs,
      cartonsAvailable:  Math.floor(total / pcs),
    }),
    adjustWarehouseStock:     async ()                       => ({ balanceBefore: 0, balanceAfter: 0 }),
  },
});

// settings is imported transitively — provide a stub so the module graph resolves.
mock.module("./settings.service", {
  exports: { getSettings: async () => ({ shopWarehouseId: SHOP_ID }) },
});

// ── Functions under test (loaded after mocks are in place) ────────────────────
let updateProduct:  Function;
let createProduct:  Function;
let getProductById: Function;
let deleteProduct:  Function;

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════════
describe("product.service", () => {
  before(async () => {
    ({ updateProduct, createProduct, getProductById, deleteProduct } =
      await import("./product.service"));
  });

  beforeEach(() => {
    branches       = makeActiveBranches();
    productStore   = makeFakeProduct();
    upsertStockSpy = makeSpy();
    syncStockSpy   = makeSpy();
    tx             = makeTx();
  });

  // ──────────────────────────────────────────────────────────────────────────
  //  updateProduct — WITH warehouseDistribution (the new edit-mode path)
  // ──────────────────────────────────────────────────────────────────────────
  describe("updateProduct — مع warehouseDistribution", () => {
    it("يُحدّث كل مخزن بالكمية الصحيحة ويُزامن المجموع", async () => {
      const dist = [
        { warehouseId: SHOP_ID, pieces: 120 },
        { warehouseId: ABB_ID,  pieces: 160 },
      ];
      await updateProduct(PROD_ID, { name: "اسم جديد", warehouseDistribution: dist });

      // يُستدعى upsertStock مرة لكل مخزن
      assert.equal(upsertStockSpy.calls.length, 2, "upsert once per warehouse");

      const shopCall = upsertStockSpy.calls.find((c) => c.args[1].warehouseId === SHOP_ID);
      const abbCall  = upsertStockSpy.calls.find((c) => c.args[1].warehouseId === ABB_ID);
      assert.ok(shopCall, "يجب أن يُحدَّث مخزن المحل");
      assert.ok(abbCall,  "يجب أن يُحدَّث مخزن العباسية");
      assert.equal(shopCall!.args[1].quantityPieces, 120, "كمية المحل = 120");
      assert.equal(abbCall!.args[1].quantityPieces,  160, "كمية العباسية = 160");

      // مزامنة المجموع تُستدعى مرة واحدة
      assert.equal(syncStockSpy.calls.length, 1, "syncProductTotalStock مرة واحدة فقط");
    });

    it("يُرسل مدخلات الصفر لتصفير مخزن بعينه (صفر ≥ 0)", async () => {
      // في وضع التعديل: pieces >= 0 — يُضمَّن الصفر لإتاحة تصفير المخزن.
      const dist = [
        { warehouseId: SHOP_ID, pieces: 200 },
        { warehouseId: ABB_ID,  pieces: 0 },   // تصفير عمدي
      ];
      await updateProduct(PROD_ID, { warehouseDistribution: dist });

      assert.equal(upsertStockSpy.calls.length, 2, "كلا المخزنين يُرسَلان حتى لو كمية = 0");
      const abbCall = upsertStockSpy.calls.find((c) => c.args[1].warehouseId === ABB_ID);
      assert.equal(abbCall!.args[1].quantityPieces, 0, "المخزن يُصفَّر بشكل صريح");
    });

    it("يرمي WAREHOUSE_NOT_FOUND إذا كان معرّف المخزن غير موجود", async () => {
      // المخزن الوهمي أوّلاً ← يرمي قبل أي upsert
      const dist = [
        { warehouseId: "ghost-wh", pieces: 150 }, // مخزن وهمي أوّلاً
        { warehouseId: SHOP_ID,    pieces: 100 },
      ];
      await assert.rejects(
        () => updateProduct(PROD_ID, { warehouseDistribution: dist }),
        (err: any) => {
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, "WAREHOUSE_NOT_FOUND");
          return true;
        },
        "يجب رمي خطأ 404 للمخزن المجهول"
      );
      // المخزن الوهمي أوّل في الحلقة → الخطأ يُرمى قبل أي upsert
      assert.equal(upsertStockSpy.calls.length, 0, "لا upsert قبل الخطأ");
    });

    it("يرمي WAREHOUSE_NOT_FOUND إذا كان المخزن غير نشط", async () => {
      branches.get(ABB_ID)!.isActive = false; // تعطيل مخزن العباسية
      const dist = [
        { warehouseId: SHOP_ID, pieces: 100 },
        { warehouseId: ABB_ID,  pieces: 50  },
      ];
      await assert.rejects(
        () => updateProduct(PROD_ID, { warehouseDistribution: dist }),
        (err: any) => {
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, "WAREHOUSE_NOT_FOUND");
          return true;
        },
        "المخزن غير النشط يُعامَل كغير موجود"
      );
    });

    it("يرمي PRODUCT_NOT_FOUND إذا كان المنتج غير موجود", async () => {
      productStore = null;
      await assert.rejects(
        () => updateProduct("no-such-id", { warehouseDistribution: [{ warehouseId: SHOP_ID, pieces: 10 }] }),
        (err: any) => {
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, "PRODUCT_NOT_FOUND");
          return true;
        }
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  //  updateProduct — بدون warehouseDistribution (المسار الاحتياطي القديم)
  // ──────────────────────────────────────────────────────────────────────────
  describe("updateProduct — بدون warehouseDistribution (fallback path)", () => {
    it("يُحدّث مخزن واحد فقط عند تغيير openingBalancePcs", async () => {
      await updateProduct(PROD_ID, { openingBalancePcs: 80 });

      assert.equal(upsertStockSpy.calls.length, 1, "مخزن واحد فقط يُحدَّث");
      assert.equal(upsertStockSpy.calls[0].args[1].warehouseId, SHOP_ID, "يُحدَّث المحل فقط");
      assert.equal(syncStockSpy.calls.length, 1);
    });

    it("يُحدّث مخزن واحد فقط عند تغيير cartonsAvailable", async () => {
      await updateProduct(PROD_ID, { cartonsAvailable: 5 });

      assert.equal(upsertStockSpy.calls.length, 1);
      assert.equal(upsertStockSpy.calls[0].args[1].warehouseId, SHOP_ID);
    });

    it("لا يُحدّث أي مخزن عند تغيير الاسم فقط — الخطأ الكلاسيكي!", async () => {
      // هذا هو السبب الجذري للخلل: تغيير الاسم لا يُفترض أن يلمس المخزون.
      await updateProduct(PROD_ID, { name: "اسم مختلف تماماً" });

      assert.equal(upsertStockSpy.calls.length, 0, "تغيير الاسم لا يُغيّر المخزون أبداً");
      assert.equal(syncStockSpy.calls.length,   0);
    });

    it("لا يُحدّث أي مخزن عند تغيير السعر فقط", async () => {
      await updateProduct(PROD_ID, { salePrice: 9000, purchasePrice: 6000 });

      assert.equal(upsertStockSpy.calls.length, 0, "تغيير السعر لا يُغيّر المخزون");
    });

    it("يُحدّث بيانات المخزن (minStock) دون تغيير الكمية", async () => {
      await updateProduct(PROD_ID, { minStock: 25 });

      assert.equal(upsertStockSpy.calls.length, 1, "تغيير minStock يستدعي upsert لتحديث البيانات");
      // الكمية تبقى undefined — الـ upsert يُحدّث minStock فقط
      assert.equal(upsertStockSpy.calls[0].args[1].quantityPieces, undefined,
        "لا تغيير في الكمية عند تعديل minStock فقط");
    });

    it("يُحدّث بيانات المخزن (storageLocation) دون تغيير الكمية", async () => {
      await updateProduct(PROD_ID, { storageLocation: "رف B-12" });

      assert.equal(upsertStockSpy.calls.length, 1);
      assert.equal(upsertStockSpy.calls[0].args[1].storageLocation, "رف B-12");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  //  createProduct
  // ──────────────────────────────────────────────────────────────────────────
  describe("createProduct", () => {
    it("يكتمل بنجاح ويُعيد المنتج عند عدم وجود توزيع", async () => {
      const result = await createProduct(
        { name: "مادة جديدة", openingBalancePcs: 50, pcsPerCarton: 1 },
        "user-1"
      );

      // الدالة يجب أن تُكمل بنجاح وتُعيد كائن المنتج
      assert.ok(result, "يجب إنشاء المنتج بنجاح");
      assert.equal(result.id, PROD_ID, "معرف المنتج صحيح");
      assert.equal(result.openingBalancePcs, 50, "openingBalancePcs محفوظ");
      // مسار else لا يستدعي syncProductTotalStock (فقط upsertWarehouseStock مباشرةً)
      assert.equal(syncStockSpy.calls.length, 0, "لا sync في مسار المخزن الافتراضي");
    });

    it("يوزّع المخزون عبر المخازن حسب warehouseDistribution", async () => {
      await createProduct(
        {
          name: "مادة موزعة",
          openingBalancePcs: 120,
          cartonsAvailable: 0,
          pcsPerCarton: 1,
          warehouseDistribution: [
            { warehouseId: SHOP_ID, pieces: 40 },
            { warehouseId: ABB_ID,  pieces: 80 },
          ],
        },
        "user-1"
      );

      assert.equal(upsertStockSpy.calls.length, 2, "upsert لكل مخزن");
      const shopPieces = upsertStockSpy.calls.find((c) => c.args[1].warehouseId === SHOP_ID)!.args[1].quantityPieces;
      const abbPieces  = upsertStockSpy.calls.find((c) => c.args[1].warehouseId === ABB_ID)!.args[1].quantityPieces;
      assert.equal(shopPieces, 40,  "المحل = 40 قطعة");
      assert.equal(abbPieces,  80,  "العباسية = 80 قطعة");
    });

    it("يرمي DISTRIBUTION_MISMATCH عندما لا يتطابق مجموع التوزيع مع الكمية", async () => {
      await assert.rejects(
        () => createProduct(
          {
            name: "خطأ في التوزيع",
            openingBalancePcs: 100,
            pcsPerCarton: 1,
            warehouseDistribution: [
              { warehouseId: SHOP_ID, pieces: 60 }, // 60 ≠ 100
            ],
          },
          "user-1"
        ),
        (err: any) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, "DISTRIBUTION_MISMATCH");
          return true;
        },
        "مجموع خاطئ يجب أن يرمي DISTRIBUTION_MISMATCH"
      );
      // لا يجب إنشاء أي سجل مخزون
      assert.equal(upsertStockSpy.calls.length, 0);
    });

    it("يرمي DISTRIBUTION_MISMATCH عندما يكون المجموع أكبر من الكمية", async () => {
      await assert.rejects(
        () => createProduct(
          {
            name: "مجموع زائد",
            openingBalancePcs: 100,
            pcsPerCarton: 1,
            warehouseDistribution: [
              { warehouseId: SHOP_ID, pieces: 60 },
              { warehouseId: ABB_ID,  pieces: 60 }, // 120 > 100
            ],
          },
          "user-1"
        ),
        (err: any) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, "DISTRIBUTION_MISMATCH");
          return true;
        }
      );
    });

    it("يرمي WAREHOUSE_NOT_FOUND عند الإشارة إلى مخزن غير موجود", async () => {
      await assert.rejects(
        () => createProduct(
          {
            name: "مخزن مجهول",
            openingBalancePcs: 100,
            pcsPerCarton: 1,
            warehouseDistribution: [{ warehouseId: "no-such-wh", pieces: 100 }],
          },
          "user-1"
        ),
        (err: any) => {
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, "WAREHOUSE_NOT_FOUND");
          return true;
        }
      );
    });

    it("يتجاهل مدخلات الصفر في التوزيع عند الإنشاء (على خلاف التعديل)", async () => {
      // عند الإنشاء: pieces > 0 فقط تُؤخذ (الفلتر يختلف عن التعديل pieces >= 0).
      await createProduct(
        {
          name: "مادة ببيانات صفرية",
          openingBalancePcs: 100,
          pcsPerCarton: 1,
          warehouseDistribution: [
            { warehouseId: SHOP_ID, pieces: 100 },
            { warehouseId: ABB_ID,  pieces: 0 },   // صفر → يُتجاهل عند الإنشاء
          ],
        },
        "user-1"
      );

      assert.equal(upsertStockSpy.calls.length, 1, "مدخل الصفر لا يُرسَل عند الإنشاء");
      assert.equal(upsertStockSpy.calls[0].args[1].warehouseId, SHOP_ID);
    });

    it("يستخدم totalPieces = openingBalancePcs + cartonsAvailable × pcsPerCarton", async () => {
      // 2 كرتون × 12 قطعة = 24 + 3 = 27 قطعة إجمالاً
      await createProduct(
        {
          name: "مادة كرتونية",
          openingBalancePcs: 3,
          cartonsAvailable: 2,
          pcsPerCarton: 12,
          warehouseDistribution: [
            { warehouseId: SHOP_ID, pieces: 27 }, // 27 = 3 + 2×12
          ],
        },
        "user-1"
      );

      assert.equal(upsertStockSpy.calls.length, 1);
      assert.equal(upsertStockSpy.calls[0].args[1].quantityPieces, 27);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  //  getProductById — تسلسل shopStock و currentStock
  // ──────────────────────────────────────────────────────────────────────────
  describe("getProductById", () => {
    it("يُرجع shopStock = قطع المحل فقط (وليس مجموع كل المخازن)", async () => {
      const product = await getProductById(PROD_ID);

      // المحل = 50، العباسية = 70 → shopStock يجب أن يكون 50 فقط
      assert.equal(product.shopStock, 50,
        "shopStock = كمية المحل تحديداً — ليس المجموع الكلي");
    });

    it("يُرجع currentStock = مجموع جميع المخازن", async () => {
      const product = await getProductById(PROD_ID);

      // 50 (محل) + 70 (عباسية) = 120
      assert.equal(product.currentStock, 120, "currentStock = مجموع المخازن = 120");
    });

    it("يرمي PRODUCT_NOT_FOUND للمعرّف غير الموجود", async () => {
      productStore = null;
      await assert.rejects(
        () => getProductById("does-not-exist"),
        (err: any) => {
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, "PRODUCT_NOT_FOUND");
          return true;
        }
      );
    });

    it("يرمي PRODUCT_NOT_FOUND للمنتج المحذوف ناعماً (deletedAt مضبوط)", async () => {
      productStore.deletedAt = new Date("2026-01-01");
      await assert.rejects(
        () => getProductById(PROD_ID),
        (err: any) => {
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, "PRODUCT_NOT_FOUND");
          return true;
        },
        "المنتج المحذوف ناعماً يُعامَل كغير موجود"
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  //  deleteProduct — حذف ناعم
  // ──────────────────────────────────────────────────────────────────────────
  describe("deleteProduct", () => {
    it("يضبط deletedAt بدلاً من الحذف الفيزيائي", async () => {
      assert.equal(productStore.deletedAt, null, "قبل الحذف: deletedAt = null");

      await deleteProduct(PROD_ID);

      assert.ok(productStore.deletedAt instanceof Date,
        "بعد الحذف: deletedAt يجب أن يكون Date");
    });

    it("يرمي PRODUCT_NOT_FOUND عند محاولة حذف منتج غير موجود", async () => {
      productStore = null;
      await assert.rejects(
        () => deleteProduct("ghost-id"),
        (err: any) => {
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, "PRODUCT_NOT_FOUND");
          return true;
        }
      );
    });

    it("يرمي PRODUCT_NOT_FOUND عند محاولة حذف منتج محذوف مسبقاً", async () => {
      productStore.deletedAt = new Date("2025-12-01");
      await assert.rejects(
        () => deleteProduct(PROD_ID),
        (err: any) => {
          assert.equal(err.statusCode, 404);
          return true;
        },
        "الحذف المزدوج يرمي خطأ بدلاً من الصمت"
      );
    });
  });
});
