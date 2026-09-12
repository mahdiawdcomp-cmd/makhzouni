/**
 * إقفال الفترة المحاسبية — the boundary is the END of the close day in Baghdad
 * local time (UTC+3), so a document stamped late on the close day is closed and
 * one stamped just after local midnight is not.
 *
 * The module under test is imported lazily: `mock.module` only takes effect for
 * imports that happen after it is registered, and a static import at the top
 * would pull the real prisma client in first and silently query the dev DB.
 */
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

let settingValue: unknown = null;
let settingThrows = false;
mock.module("../config/database", {
  exports: {
    default: {
      setting: {
        findUnique: async () => {
          if (settingThrows) throw new Error("db down");
          return settingValue === null ? null : { key: "accountingCloseDate", value: settingValue };
        },
      },
    },
  },
});

let isWithinClosedPeriod: (date: string | Date | null | undefined, closeDate: string) => boolean;
let periodOpensAt: (closeDate: string) => Date | null;
let assertPeriodOpen: (date?: string | Date | null) => Promise<void>;

describe("accounting period close", () => {
  before(async () => {
    ({ isWithinClosedPeriod, periodOpensAt, assertPeriodOpen } = await import("./accounting-period"));
  });

  it("لا يقفل شيئاً عندما يكون التاريخ فارغاً أو غير صالح", () => {
    assert.equal(periodOpensAt(""), null);
    assert.equal(periodOpensAt("2026-13-99"), null);
    assert.equal(isWithinClosedPeriod("2020-01-01", ""), false);
  });

  it("يقفل المستند المؤرخ قبل يوم الإقفال", () => {
    assert.equal(isWithinClosedPeriod("2026-07-15T10:00:00.000Z", "2026-08-31"), true);
  });

  it("يقفل المستند المؤرخ في يوم الإقفال نفسه حتى آخر لحظة محلية", () => {
    // 2026-08-31 23:59 Baghdad = 20:59Z — still inside the closed day.
    assert.equal(isWithinClosedPeriod("2026-08-31T20:59:00.000Z", "2026-08-31"), true);
  });

  it("لا يقفل المستند المؤرخ بعد منتصف ليل بغداد", () => {
    // 2026-09-01 00:00 Baghdad = 2026-08-31 21:00Z — the first open instant.
    assert.equal(isWithinClosedPeriod("2026-08-31T21:00:00.000Z", "2026-08-31"), false);
    assert.equal(isWithinClosedPeriod("2026-09-01T06:00:00.000Z", "2026-08-31"), false);
  });

  it("أول لحظة مفتوحة هي منتصف ليل اليوم التالي بتوقيت بغداد", () => {
    assert.equal(periodOpensAt("2026-08-31")?.toISOString(), "2026-08-31T21:00:00.000Z");
  });

  describe("assertPeriodOpen", () => {
    it("يرفض مستنداً داخل الفترة المقفلة برمز واضح", async () => {
      settingValue = "2026-08-31";
      settingThrows = false;
      await assert.rejects(
        () => assertPeriodOpen("2026-08-10T09:00:00.000Z"),
        (err: any) => err.code === "ACCOUNTING_PERIOD_CLOSED" && err.statusCode === 423,
      );
    });

    it("يمرّر مستنداً بعد الفترة المقفلة", async () => {
      settingValue = "2026-08-31";
      settingThrows = false;
      await assertPeriodOpen("2026-09-05T09:00:00.000Z");
    });

    it("لا يقفل شيئاً عندما يكون الإعداد فارغاً", async () => {
      settingValue = "";
      settingThrows = false;
      await assertPeriodOpen("2020-01-01T00:00:00.000Z");
    });

    it("لا يوقف البيع إذا فشلت قراءة الإعداد", async () => {
      settingThrows = true;
      await assertPeriodOpen("2020-01-01T00:00:00.000Z");
    });
  });
});
