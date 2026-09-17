/**
 * «الطلبات المعلّقة عند ضعف الإنترنت» — driven in a real browser, really offline.
 *
 * The unit tests prove the queue's rules. Only a browser can prove the thing the
 * rep actually experiences: prepare an order, lose the network mid-send, reload
 * the page, get the network back, be TOLD there is an attempt waiting, re-check
 * it, and end up with exactly ONE order.
 *
 * The network is cut with Playwright's `context.setOffline(true)`, so
 * `navigator.onLine` flips and the app's own offline handling runs — not a
 * mocked failure.
 *
 * ── Running it ──────────────────────────────────────────────────────────
 *
 *   npm run build                    # the tests drive the BUILT app
 *   npx playwright install chromium  # once per machine
 *   npm run test:browser
 *
 * Chromium is NOT installed by `npm install` on purpose — it is hundreds of
 * megabytes that most people working on this repo never need. When it is
 * missing these tests fail with a one-line instruction instead of a stack
 * trace, and they leave no process behind.
 *
 * ── Why every test owns its own server ──────────────────────────────────
 *
 * Each test starts a fixture on an OS-assigned port (`FIXTURE_PORT=0`) and
 * registers its shutdown with `t.after` the moment it is up — BEFORE the
 * browser is launched. An earlier version registered cleanup only after the
 * launch, so a machine without Chromium left the fixture holding port 4188 and
 * every later run failed with a misleading «fixture server did not start».
 *
 * No database, no backend, no production data, and no real order anywhere.
 *
 * Viewports: 390x844 (phone) and 1024x768 (iPad), because that is what the rep
 * holds.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const START_TIMEOUT_MS = 15_000;

const REP = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "مندوب الاختبار",
  username: "fixture",
  role: "STAFF",
  permissions: ["SALES_AGENT"],
  isActive: true,
};

/** The owner, for the screens a rep is not allowed to open. */
const OWNER = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "المالك",
  username: "owner",
  role: "ADMIN",
  permissions: [],
  isActive: true,
};

/** Playwright is a devDependency; say so plainly rather than crashing. */
async function loadChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch {
    throw new Error(
      "playwright is not installed. Run: npm install --save-dev playwright && npx playwright install chromium",
    );
  }
}

/**
 * Start a fixture on a free port.
 *
 * Resolves with the origin AND a `stop()` that is safe to call twice. Rejects
 * with the server's REAL stderr when it dies during startup, instead of sitting
 * out the whole timeout on a generic message.
 */
function startFixture() {
  const child = spawn(process.execPath, [join(here, "sales-agent-fixture-server.cjs")], {
    env: { ...process.env, FIXTURE_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stopped = false;
  const stop = () =>
    new Promise((resolve) => {
      if (stopped || child.exitCode !== null) {
        stopped = true;
        resolve();
        return;
      }
      stopped = true;
      child.once("exit", () => resolve());
      child.kill();
      // A stubborn child must not hold the suite open.
      const hard = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        resolve();
      }, 2_000);
      hard.unref?.();
    });

  return new Promise((resolve, reject) => {
    let stderr = "";
    let ready = false;

    const timer = setTimeout(() => {
      void stop();
      reject(new Error(`fixture server did not start within ${START_TIMEOUT_MS}ms. stderr: ${stderr || "(empty)"}`));
    }, START_TIMEOUT_MS);

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.stdout.on("data", (chunk) => {
      const match = /fixture server on (http:\/\/127\.0\.0\.1:\d+)/.exec(String(chunk));
      if (!match) return;
      ready = true;
      clearTimeout(timer);
      resolve({ origin: match[1], stop });
    });

    // Died before it was ready: surface what it actually said rather than
    // waiting out the timeout on a generic message.
    child.once("exit", (code) => {
      if (ready) return;
      clearTimeout(timer);
      stopped = true;
      reject(new Error(`fixture server exited with code ${code} before becoming ready. stderr: ${stderr || "(empty)"}`));
    });

    child.once("error", (err) => {
      if (ready) return;
      clearTimeout(timer);
      void stop();
      reject(err);
    });
  });
}

/**
 * Bring up a fixture + browser for one test, registering every teardown with
 * `t.after` as soon as the thing exists. Whatever fails next — a missing
 * browser, a failed assertion — nothing is left running.
 */
async function harness(t, viewport, opts = {}) {
  const { user = REP, path = "/sales-agent", ready = "text=الكتلوك", adminFixture = false } = opts;
  const chromium = await loadChromium();

  const fixture = await startFixture();
  // Registered BEFORE the browser launch: this is the line whose absence left a
  // fixture holding a port on machines without Chromium.
  t.after(() => fixture.stop());

  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    throw new Error(`could not launch chromium (${err.message}). Run: npx playwright install chromium`);
  }
  t.after(() => browser.close().catch(() => {}));

  const context = await browser.newContext();
  t.after(() => context.close().catch(() => {}));

  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.addInitScript(
    ({ user, origin }) => {
      localStorage.setItem("inventory_token", "fixture-only");
      localStorage.setItem("inventory_user", JSON.stringify(user));
      // The owner's onboarding wizard is pinned bottom-left and, at phone
      // width, sits on top of whatever dialog is open — it intercepted the taps
      // this test makes. It is unrelated to what is under test, so it starts
      // dismissed, exactly as it would be for any owner who has closed it once.
      localStorage.setItem("onboarding_dismissed_v1", "1");
      // The production build points axios at a fixed API base. Rewriting it in
      // the page keeps the test on the fixture without a special build.
      const open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        const next = typeof url === "string" ? url.replace(/^https?:\/\/[^/]+\/api/, `${origin}/api`) : url;
        return open.call(this, method, next, ...rest);
      };
      const fetchOriginal = window.fetch;
      window.fetch = (input, init) => {
        if (typeof input === "string") {
          return fetchOriginal(input.replace(/^https?:\/\/[^/]+\/api/, `${origin}/api`), init);
        }
        return fetchOriginal(input, init);
      };
    },
    // The init script runs on EVERY navigation, so the identity has to be the
    // one this test wants — writing the rep in here and swapping localStorage
    // later just got overwritten on the next page load.
    { user, origin: fixture.origin },
  );

  await fetch(`${fixture.origin}/__fixture/reset`);
  // `/auth/me` must agree with the stored user, or the app re-hydrates as the
  // other role on first load.
  if (adminFixture) await fetch(`${fixture.origin}/__fixture/role?admin=1`);

  await page.goto(`${fixture.origin}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(ready, { timeout: 20_000 });

  return { page, context, origin: fixture.origin };
}

const clickByText = async (page, text) => {
  await page.locator("button", { hasText: text }).first().click();
};

/**
 * Choosing a customer opens the cart sheet, which covers the catalog. Close any
 * open dialog before touching what is behind it — clicking through an overlay is
 * exactly the kind of thing a real thumb cannot do either.
 */
async function closeDialogs(page) {
  for (let i = 0; i < 3; i += 1) {
    if ((await page.locator('[role="dialog"]').count()) === 0) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
}

/** Put a line in the cart from «يشتريها عادةً» after choosing a customer. */
async function prepareOrder(page) {
  await clickByText(page, "زبائني");
  await page.waitForSelector("text=أسواق الربيع", { timeout: 15_000 });
  await clickByText(page, "بيع");
  await closeDialogs(page);
  await page.waitForSelector("text=يشتريها عادةً", { timeout: 15_000 });
  await page.locator("button", { hasText: /^أضف \d/ }).first().click();
  await page.waitForSelector("text=/\\d+ سطر/", { timeout: 10_000 });
}

const pendingKey = (page) =>
  page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("sales-agent-workspace"));
    if (!k) return null;
    const ws = JSON.parse(localStorage.getItem(k));
    return Object.values(ws.drafts ?? {}).find((d) => d.pending)?.pending.clientRequestId ?? null;
  });

test("an unconfirmed send survives going offline and a reload, and re-checking creates no duplicate", async (t) => {
  const { page, context, origin } = await harness(t, { width: 390, height: 844 });

  await prepareOrder(page);

  // ── the review, then the send that never gets an answer ─────────────
  // Open the cart sheet from the bottom bar, then press review INSIDE it: the
  // tablet layout keeps a second copy of that button in a hidden aside.
  await clickByText(page, "سطر");
  await page.waitForSelector('[role="dialog"][aria-label="الطلب"]', { timeout: 10_000 });
  await page.locator('[role="dialog"] button', { hasText: "مراجعة الطلب" }).first().click();
  await page.waitForSelector('[role="dialog"][aria-label="راجع الطلب قبل الإرسال"]', { timeout: 15_000 });

  await context.setOffline(true);
  await page.waitForFunction(() => navigator.onLine === false, null, { timeout: 10_000 });

  // Offline, the send button says so and refuses to fire.
  const sendButton = page.locator('[role="dialog"] button', { hasText: /ماكو اتصال|تأكيد وإرسال/ }).first();
  assert.match(await sendButton.innerText(), /ماكو اتصال/, "the review refuses to send with no connection");
  assert.equal(await sendButton.isDisabled(), true);

  // Back online, with the server answering 502: this is the "sent, never
  // answered" case the whole queue exists for.
  await context.setOffline(false);
  await page.waitForFunction(() => navigator.onLine === true, null, { timeout: 10_000 });
  await fetch(`${origin}/__fixture/fail-orders?on=1`);
  await clickByText(page, "تأكيد وإرسال الطلب");

  await page.waitForFunction(
    () => {
      const key = Object.keys(localStorage).find((k) => k.startsWith("sales-agent-workspace"));
      if (!key) return false;
      const ws = JSON.parse(localStorage.getItem(key));
      return Object.values(ws.drafts ?? {}).some((d) => d.pending?.clientRequestId);
    },
    null,
    { timeout: 15_000 },
  );

  const keyBefore = await pendingKey(page);
  assert.ok(keyBefore, "the attempt kept an idempotency key");

  // ── a reload must not lose it ───────────────────────────────────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=الطلبات المعلّقة", { timeout: 20_000 });
  assert.equal(await pendingKey(page), keyBefore, "the SAME key survived the reload");

  // ── offline again, then the connection returns ──────────────────────
  await context.setOffline(true);
  await page.waitForFunction(() => navigator.onLine === false, null, { timeout: 10_000 });
  await context.setOffline(false);
  await page.waitForFunction(() => navigator.onLine === true, null, { timeout: 10_000 });

  // The rep is TOLD, and nothing was sent on its own.
  await page.waitForSelector("text=رجع الإنترنت", { timeout: 15_000 });
  const afterReconnect = await (await fetch(`${origin}/__fixture/order-keys`)).json();
  assert.equal(afterReconnect.data.distinctKeys, 0, "nothing may be sent automatically on reconnect");

  // ── the rep re-checks; the server now answers ───────────────────────
  await fetch(`${origin}/__fixture/fail-orders?on=0`);
  await clickByText(page, "راجع الطلبات المعلّقة");
  await page.waitForSelector("text=بانتظار الاتصال", { timeout: 15_000 });
  await clickByText(page, "إعادة التحقق بنفس المحاولة");
  await page.waitForSelector("text=انرسل الطلب", { timeout: 20_000 });

  const afterRetry = await (await fetch(`${origin}/__fixture/order-keys`)).json();
  assert.equal(afterRetry.data.distinctKeys, 1, "one order, not two");
  assert.equal(await pendingKey(page), null, "a confirmed order clears its own draft");

  await t.diagnostic("phone 390x844: offline → reload → reconnect → one order");
});

test("the rep screens fit an iPad without a horizontal scroll", async (t) => {
  const { page } = await harness(t, { width: 1024, height: 768 });

  for (const tab of ["زبائني", "زياراتي", "الكتلوك"]) {
    await closeDialogs(page);
    await clickByText(page, tab);
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `${tab} must not scroll sideways at 1024px`);
    const smallTargets = await page.evaluate(
      () =>
        [...document.querySelectorAll("main button")].filter((b) => {
          const r = b.getBoundingClientRect();
          return r.height > 0 && r.height < 40;
        }).length,
    );
    assert.equal(smallTargets, 0, `${tab} must keep touch targets at 44px`);
  }

  await t.diagnostic("iPad 1024x768: no sideways scroll, no small touch targets");
});

test("catalog filters and 2/3/4 picture layout work on phone and iPad", async (t) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }]) {
    const { page } = await harness(t, viewport);
    const cards = page.locator(".sales-agent-product");
    await page.waitForFunction(() => document.querySelectorAll(".sales-agent-product").length === 12);
    for (const count of [3, 4, 2]) {
      await page.getByRole("button", { name: `${count} صور في السطر` }).click();
      assert.equal(await page.getByRole("button", { name: `${count} صور في السطر` }).getAttribute("aria-pressed"), "true");
      assert.equal(await cards.first().evaluate(el => getComputedStyle(el.parentElement).gridTemplateColumns.split(" ").length), count);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    }
    await page.getByRole("button", { name: "الفلاتر" }).click();
    await page.getByRole("button", { name: "العروض" }).click();
    assert.equal(await cards.count(), 1, "offer filter narrows the cards");
    await page.getByRole("button", { name: "مسح الفلاتر" }).click();
    assert.equal(await cards.count(), 12, "clear restores all cards");
    await page.getByRole("button", { name: "4 صور في السطر" }).click();
    await page.reload();
    assert.equal(await page.getByRole("button", { name: "4 صور في السطر" }).getAttribute("aria-pressed"), "true", "layout persists on this device");
  }
});

test("the owner's visit-plan screen works on a phone and an iPad", async (t) => {
  // The fixture rep has exactly these two customers.
  const CUSTOMERS = ["أسواق الربيع", "مكتبة النور"];

  for (const viewport of [
    { width: 390, height: 844, label: "phone 390x844" },
    { width: 1024, height: 768, label: "iPad 1024x768" },
  ]) {
    await t.diagnostic(`opening the owner's plan screen at ${viewport.label}`);
    const { page } = await harness(t, viewport, {
      user: OWNER,
      adminFixture: true,
      path: "/sales-agents",
      ready: "text=خطة زيارات المندوب",
    });

    // Everything is scoped to the panel: the sidebar and header carry buttons
    // with the same words, and a test that clicks those is testing nothing.
    const panel = page.locator('div[dir="rtl"]', { hasText: "خطة زيارات المندوب" }).last();
    const sheet = page.locator('[role="dialog"][aria-label="أضف زبائن لخطة اليوم"]');

    // Choosing the rep loads their (empty) plan for that day.
    await panel.locator("button", { hasText: "مندوب الاختبار" }).first().click();
    await panel.getByText("ماكو خطة لهذا اليوم").first().waitFor({ timeout: 15_000 });

    // Add both of THAT rep's customers, by name rather than by position.
    await panel.locator("button", { hasText: "أضف زبائن للخطة" }).first().click();
    await sheet.waitFor({ timeout: 10_000 });
    for (const name of CUSTOMERS) {
      // Wait for the row itself before reaching for its button: the list is a
      // query result, so it arrives a beat after the sheet does.
      await sheet.getByText(name).first().waitFor({ timeout: 15_000 });
      await sheet.locator("li", { hasText: name }).locator("button", { hasText: "أضف" }).first().click();
      await page.waitForTimeout(600);
    }
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached", timeout: 10_000 });

    const rows = () => panel.locator("li");
    await rows().first().waitFor({ timeout: 15_000 });
    assert.equal(await rows().count(), 2, `${viewport.label}: both customers are on the plan`);
    const firstBefore = await rows().first().innerText();
    assert.ok(firstBefore.includes("1."), "the plan is numbered in visit order");
    assert.ok(firstBefore.includes(CUSTOMERS[0]), "added in the order they were picked");

    // Reorder with buttons — no drag-and-drop on a phone.
    await rows().nth(1).locator("button", { hasText: "فوق" }).click();
    // Poll rather than sleep: the swap is a write plus a refetch.
    await rows().first().getByText(CUSTOMERS[1]).waitFor({ timeout: 10_000 });
    assert.ok(
      (await rows().first().innerText()).includes(CUSTOMERS[1]),
      `${viewport.label}: «فوق» moved the second stop to the top`,
    );

    // Cancel the intention, then bring it back.
    await rows().first().locator("button", { hasText: "إلغاء الزيارة المخططة" }).click();
    await panel.getByText("أُلغيت").first().waitFor({ timeout: 15_000 });
    await rows().first().locator("button", { hasText: "إرجاع للخطة" }).click();
    await page.waitForTimeout(900);
    assert.equal(
      await panel.getByText("أُلغيت").count(),
      0,
      `${viewport.label}: restoring a cancelled stop brings it back to planned`,
    );

    // A customer already on the plan is marked, not offered again.
    await panel.locator("button", { hasText: "أضف زبائن للخطة" }).first().click();
    await sheet.waitFor({ timeout: 10_000 });
    assert.equal(
      await sheet.locator("button", { hasText: "موجود بالخطة" }).count(),
      2,
      `${viewport.label}: both planned customers are marked as already planned`,
    );
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached", timeout: 10_000 });

    // Layout: no sideways scroll, and every button in THIS panel stays
    // thumb-sized. Scoped to the panel on purpose — three older buttons
    // elsewhere on the reps page («سجّل الاستلام», «ثبّت الشهر», «اعرض») are
    // 36px, which predates this work and is not ours to change here.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `${viewport.label}: must not scroll sideways`);
    const smallTargets = await panel.evaluate(
      (root) =>
        [...root.querySelectorAll("button")].filter((b) => {
          const r = b.getBoundingClientRect();
          return r.height > 0 && r.height < 40;
        }).length,
    );
    assert.equal(smallTargets, 0, `${viewport.label}: the plan panel keeps touch targets at 44px`);

    await t.diagnostic(`${viewport.label}: plan add → reorder → cancel → restore → duplicate marked`);
  }
});
