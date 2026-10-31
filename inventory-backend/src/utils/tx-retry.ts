// Retries a whole transaction when Postgres aborts it for a deadlock (40P01)
// or a serialization failure (40001). Two invoices touching the same products
// in opposite order lock rows in opposite order; Postgres kills one of them.
// The aborted transaction was rolled back in full, so running it again is safe.
function isRetryable(err: unknown) {
  const e = err as { code?: string; meta?: { code?: string }; message?: string } | null;
  if (!e) return false;
  if (e.code === "P2034") return true; // Prisma: write conflict or deadlock
  if (e.meta?.code === "40P01" || e.meta?.code === "40001") return true;
  return /40P01|40001|deadlock detected|could not serialize/i.test(e.message ?? "");
}

export async function withTxRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run();
    } catch (err) {
      if (i >= attempts || !isRetryable(err)) throw err;
      await new Promise((r) => setTimeout(r, 50 * i + Math.floor(Math.random() * 50)));
    }
  }
}
