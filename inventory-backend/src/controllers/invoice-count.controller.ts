import { InvoiceCountAudience } from "@prisma/client";

import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  acknowledgeRefund,
  createCountLink,
  getCountLinkByToken,
  listCountLinks,
  releaseEditLock,
  revokeCountLink,
  submitCount,
  touchEditLock,
  type CountSubmissionLine,
} from "../services/invoice-count.service";

function requireUser(user: Express.User | undefined) {
  if (!user) throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  return user;
}

// ── Shop side (authenticated) ────────────────────────────────────────────────

export const listInvoiceCountLinks = asyncHandler(async (req, res) => {
  const links = await listCountLinks(String(req.params.id));
  res.json({ success: true, data: links });
});

export const createInvoiceCountLink = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const audience = String(req.body.audience) as InvoiceCountAudience;
  if (audience !== InvoiceCountAudience.WORKER && audience !== InvoiceCountAudience.CUSTOMER) {
    throw new AppError("نوع الرابط غير صحيح", 400, "INVALID_AUDIENCE");
  }

  const link = await createCountLink({
    invoiceId: String(req.params.id),
    audience,
    workerId: req.body.workerId ? String(req.body.workerId) : undefined,
    createdBy: user.id,
  });

  res.status(201).json({ success: true, message: "تم إنشاء رابط الجرد", data: link });
});

export const revokeInvoiceCountLink = asyncHandler(async (req, res) => {
  const link = await revokeCountLink(String(req.params.linkId));
  res.json({ success: true, message: "تم إلغاء الرابط", data: link });
});

export const acknowledgeCountRefund = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const link = await acknowledgeRefund(String(req.params.linkId), user.id);
  res.json({ success: true, message: "تم تسجيل إرجاع المبلغ", data: link });
});

/**
 * Editing heartbeat. Called while the invoice edit screen is open so the public
 * counting page can tell its reader to wait; released when the screen closes.
 */
export const heartbeatInvoiceEdit = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  await touchEditLock(String(req.params.id), user.id, user.name ?? "موظف");
  res.json({ success: true });
});

export const releaseInvoiceEdit = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  await releaseEditLock(String(req.params.id), user.id);
  res.json({ success: true });
});

// ── Public side (token only) ─────────────────────────────────────────────────

export const getPublicCountLink = asyncHandler(async (req, res) => {
  const view = await getCountLinkByToken(String(req.params.token), true);
  res.json({ success: true, data: view });
});

/** Cheap poll used by the counting page to watch the edit lock. */
export const getPublicCountLinkStatus = asyncHandler(async (req, res) => {
  const view = await getCountLinkByToken(String(req.params.token), false);
  res.json({
    success: true,
    data: { blocked: view.blocked, editingBy: view.editingBy },
  });
});

export const submitPublicCount = asyncHandler(async (req, res) => {
  const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : null;
  if (!rawLines || rawLines.length === 0) {
    throw new AppError("لم يصل أي جرد", 400, "COUNT_EMPTY");
  }

  const lines: CountSubmissionLine[] = rawLines.map((line: unknown) => {
    const row = line as { itemId?: unknown; receivedPieces?: unknown };
    if (typeof row?.itemId !== "string" || !row.itemId) {
      throw new AppError("سطر جرد غير صالح", 400, "INVALID_COUNT_LINE");
    }
    return { itemId: row.itemId, receivedPieces: Number(row.receivedPieces) };
  });

  const result = await submitCount(String(req.params.token), lines);
  res.json({
    success: true,
    message: result.hasDifference
      ? "تم إرسال الجرد مع الفروقات. شكراً لك."
      : "تم إرسال الجرد — كل شيء مطابق. شكراً لك.",
    data: {
      applied: result.applied,
      hasDifference: result.hasDifference,
      differenceCount: result.result.differenceCount,
    },
  });
});
