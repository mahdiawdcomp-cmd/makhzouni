import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/app-error";
import {
  deletePayment,
  getRevenueSummary,
  listPayments,
  recordPayment,
  renewClient,
} from "../services/payments.service";

export async function getPayments(req: Request, res: Response, next: NextFunction) {
  try {
    const { clientId } = req.query as { clientId?: string };
    const payments = await listPayments(clientId);
    res.json({ success: true, data: payments });
  } catch (err) { next(err); }
}

export async function postPayment(req: Request, res: Response, next: NextFunction) {
  try {
    const { clientId, amount, currency, paidAt, method, notes } = req.body as {
      clientId?: string; amount?: number; currency?: string;
      paidAt?: string; method?: string; notes?: string;
    };
    if (!clientId) throw new AppError("clientId مطلوب", 400, "VALIDATION_ERROR");
    if (!amount || amount <= 0) throw new AppError("المبلغ يجب أن يكون أكبر من صفر", 400, "VALIDATION_ERROR");
    const payment = await recordPayment({ clientId, amount, currency, paidAt, method, notes });
    res.status(201).json({ success: true, data: payment });
  } catch (err) { next(err); }
}

export async function postRenew(req: Request, res: Response, next: NextFunction) {
  try {
    const { months, amount, currency, method, notes } = req.body as {
      months?: number; amount?: number; currency?: string; method?: string; notes?: string;
    };
    const clientId = req.params.clientId as string;
    if (!clientId) throw new AppError("clientId مطلوب", 400, "VALIDATION_ERROR");
    const m = Number(months);
    if (!m || m < 1) throw new AppError("المدة يجب أن تكون شهر على الأقل", 400, "VALIDATION_ERROR");
    if (!amount || amount < 0) throw new AppError("المبلغ غير صالح", 400, "VALIDATION_ERROR");
    const result = await renewClient({ clientId, months: m, amount, currency, method, notes });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function deletePaymentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await deletePayment(req.params.id as string);
    res.json({ success: true, message: "تم الحذف" });
  } catch (err) { next(err); }
}

export async function getRevenue(req: Request, res: Response, next: NextFunction) {
  try {
    const summary = await getRevenueSummary();
    res.json({ success: true, data: summary });
  } catch (err) { next(err); }
}
