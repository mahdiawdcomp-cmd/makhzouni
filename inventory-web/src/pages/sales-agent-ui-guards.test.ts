import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, "SalesAgentPage.tsx"), "utf8")

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
