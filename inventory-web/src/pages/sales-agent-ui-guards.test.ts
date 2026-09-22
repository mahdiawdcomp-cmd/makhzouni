import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
/**
 * The rep's page, as ONE text — however many files it is split across.
 *
 * SalesAgentPage.tsx was split into modules under sales-agent/ once it passed
 * 3000 lines. These guards are about the page's behaviour, not about which file
 * a function happens to live in, so they read every file the page is made of.
 * A new module the page is split into belongs in this list, or the guards stop
 * looking at the code they exist to watch.
 */
const PAGE_FILES = [
  "SalesAgentPage.tsx",
  "sales-agent/model.ts",
  "sales-agent/ui.tsx",
  "sales-agent/hooks.ts",
  "sales-agent/CatalogScreen.tsx",
  "sales-agent/CartPanel.tsx",
  "sales-agent/CustomersScreen.tsx",
  "sales-agent/OrdersScreen.tsx",
  "sales-agent/MoneyScreen.tsx",
  "sales-agent/IssueScreens.tsx",
  "sales-agent/CustomerDetailScreen.tsx",
  "sales-agent/DocumentDialogs.tsx",
]
const src = PAGE_FILES.map((file) => readFileSync(join(here, file), "utf8")).join("\n")
// The rep screen's shared primitives (dialog, pills, money) moved into their
// own module when the new screens — pending orders, follow-up, visits — needed
// the same ones. Guards that are about those primitives read them there.
const shared = readFileSync(join(here, "sales-agent", "shared.tsx"), "utf8")

/**
 * `isLoading` is `isPending && isFetching`. A query that is pending but not
 * fetching — retry backoff, or paused because the browser reports itself
 * offline or the tab lost focus — has `isLoading` false AND `isError` false,
 * so every list fell through to its own "you have nothing" copy. With the
 * backend unreachable the rep was told «ما عندك زبائن بعد» and invited to
 * create customers that already exist.
 */
test("list guards test isPending, never isLoading", () => {
  assert.equal(
    /\.isLoading\b/.test(src),
    false,
    "use isPending — isLoading is false during retry backoff and while paused",
  )
})

/** A paused query never resolves on its own, so a spinner there never stops. */
test("a paused query is reported, not spun on forever", () => {
  assert.match(src, /fetchStatus === "paused"/)
  assert.match(src, /function Waiting\(/)
})

/**
 * Every list that can say "you have none of these" must first be able to say
 * "the request failed" — otherwise a failure reads as a fact about the data.
 */
test("every empty-state list has an error branch", () => {
  const lists = ["customers", "orders", "receipts", "handovers", "prices", "issues", "statement"]
  for (const name of lists) {
    assert.match(
      src,
      new RegExp(`${name}\.error \?`),
      `${name} can render an empty state but has no error branch`,
    )
  }
})

/**
 * «معي الآن» is the rep's own cash. Printing 0 from a request that never
 * arrived is a claim they would act on.
 */
test("money tiles do not print zero from a failed or unfinished read", () => {
  assert.match(src, /const cashBroken = /)
  assert.match(src, /const todayBroken = /)
  assert.equal(
    /money\(cash\.data\?\.collected \?\? 0\)/.test(src),
    false,
    "?? 0 turns a missing answer into a figure",
  )
})

/**
 * «أكو مشكلة» opens on top of the product dialog and one Escape closed both —
 * the rep backing out of the note also lost the quantity they had set.
 */
test("Escape closes the top dialog only", () => {
  assert.match(shared, /dialogStack/)
  assert.match(shared, /dialogStack\[dialogStack\.length - 1\] !== token/)
})

/**
 * Two taps land in the same tick, before React can disable the button. Every
 * save on this page produced a twin without this.
 */
test("every save goes through the one-tap guard", () => {
  assert.match(src, /function useOnce\(/)
  assert.equal(
    /onClick=\{\(\) => (submit|save)\.mutate\(\)\}/.test(src),
    false,
    "a save wired straight to mutate() can fire twice on one double tap",
  )
})

/** A decimal separator in the quantity read as a digit: «1.5» meant 15. */
test("quantities are whole units and Arabic digits count", () => {
  assert.match(src, /function wholeUnits\(/)
  assert.match(src, /function toAsciiDigits\(/)
  assert.equal(
    /setQty\(Number\(e\.target\.value\.replace/.test(src),
    false,
    "stripping non-digits turns «1.5» into 15",
  )
})

/**
 * A from-scratch copy of the BOX conversion once lived on this page and
 * rounded DOWN for an odd carton size instead of up — pcsPerCarton=5 showed a
 * box as 5 pieces (a full carton) here while the server billed it at 3. The
 * rep read a wrong preview price, and the picker's max-quantity was wrong off
 * the same broken number. Every other order-taking page already shares one
 * implementation in utils/units.ts; this page must too.
 */
test("box-size math comes from the shared unit util, not a local copy", () => {
  // `(\.\.\/)+` because the conversion now lives one folder deeper, in model.ts.
  assert.match(src, /from "(\.\.\/)+utils\/units"/, "must import the shared conversion, not reimplement it")
  assert.equal(
    /function effectiveBoxPieces\(/.test(src),
    false,
    "a local effectiveBoxPieces is exactly the copy that drifted from the server before",
  )
})

/* ── the new screens ─────────────────────────────────────────────────── */

const pendingSrc = readFileSync(join(here, "sales-agent", "PendingOrdersScreen.tsx"), "utf8")
const visitsSrc = readFileSync(join(here, "sales-agent", "VisitsScreen.tsx"), "utf8")
const insightsSrc = readFileSync(join(here, "sales-agent", "CustomerInsights.tsx"), "utf8")
const reviewSrc = readFileSync(join(here, "sales-agent", "OrderReviewDialog.tsx"), "utf8")

/**
 * One lost answer must never become three real orders. Nothing in the pending
 * queue may send by itself: the rep taps, with the ORIGINAL key, and the server
 * decides whether that key already produced an order.
 */
test("the pending queue never sends anything on its own", () => {
  for (const forbidden of [/setInterval/, /setTimeout\s*\(/, /useEffect\([^)]*=>\s*\{[^}]*mutate/]) {
    assert.equal(forbidden.test(pendingSrc), false, `background sending: ${forbidden}`)
  }
  // Editing an unresolved attempt is what would change goods under a key the
  // shop may already hold.
  assert.match(pendingSrc, /disabled=\{!settled\}/)
})

/**
 * The rep's own position is asked for on a tap and used for one request. A
 * watcher, or a request on mount, would be exactly the background tracking this
 * feature promises not to do.
 */
test("the visits screen never tracks the rep in the background", () => {
  assert.equal(/watchPosition/.test(visitsSrc), false, "no position watcher anywhere")
  assert.match(visitsSrc, /function askPosition/)
  assert.equal(
    /useEffect\([^)]*askPosition/.test(visitsSrc),
    false,
    "a position must be a deliberate tap, never something that happens on open",
  )
  // The only coordinates ever written belong to the customer's shop.
  assert.match(visitsSrc, /customers\/\$\{payload\.customerId\}\/location/)
})

/**
 * The historical price is evidence of what the customer paid, not an offer to
 * sell at it again. Today's price — offer, approved price or catalog — comes
 * from the server on every read.
 */
test("no screen sells at a historical price or computes the final price itself", () => {
  for (const [name, text] of [["insights", insightsSrc], ["review", reviewSrc]] as const) {
    assert.match(text, /currentPrice|unitPrice/, name)
    assert.equal(/previousPrice\s*\*/.test(text), false, `${name} must not price anything off the old number`)
  }
  // The order that gets sent carries the token the SERVER produced, so a price
  // or stock change after the review refuses the send instead of repricing it.
  assert.match(src, /reviewToken: review!\.reviewToken/)
  assert.match(src, /orders\/preview/)
})
