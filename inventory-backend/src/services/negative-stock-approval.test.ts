import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approvalRequestTypes } from "./approval.service";
import { createInvoiceSchema } from "../utils/schemas";

// The negative-stock sale feature: a SALE may go below zero when the seller opts in,
// and the shortage is logged as a NEGATIVE_STOCK_SALE approval (acknowledgment only).

describe("negative-stock approval type", () => {
  it("registers NEGATIVE_STOCK_SALE in the approval request types", () => {
    assert.equal(approvalRequestTypes.NEGATIVE_STOCK_SALE, "NEGATIVE_STOCK_SALE");
  });
});

describe("createInvoiceSchema — allowNegativeStock opt-in", () => {
  const base = {
    body: {
      customerId: "11111111-1111-1111-1111-111111111111",
      type: "SALE",
      discount: 0,
      tax: 0,
      paidAmount: 0,
      items: [
        {
          productId: "22222222-2222-2222-2222-222222222222",
          unit: "PIECE",
          quantity: 5,
          allowNegativeStock: true,
        },
      ],
    },
  };

  it("accepts an item flagged allowNegativeStock", () => {
    const parsed = createInvoiceSchema.parse(base);
    assert.equal(parsed.body.items[0].allowNegativeStock, true);
  });

  it("defaults allowNegativeStock to undefined when omitted", () => {
    const parsed = createInvoiceSchema.parse({
      body: {
        ...base.body,
        items: [{ productId: "22222222-2222-2222-2222-222222222222", unit: "PIECE", quantity: 5 }],
      },
    });
    assert.equal(parsed.body.items[0].allowNegativeStock, undefined);
  });

  it("still rejects a zero quantity even with the negative flag", () => {
    assert.throws(() =>
      createInvoiceSchema.parse({
        body: {
          ...base.body,
          items: [
            {
              productId: "22222222-2222-2222-2222-222222222222",
              unit: "PIECE",
              quantity: 0,
              allowNegativeStock: true,
            },
          ],
        },
      })
    );
  });
});
