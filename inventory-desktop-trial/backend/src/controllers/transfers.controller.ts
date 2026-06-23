import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";
import * as transferService from "../services/transfer.service";

export async function listTransfers(req: Request, res: Response, next: NextFunction) {
  try {
    const { branchId, page, limit } = req.query;
    const result = await transferService.listTransfers({
      branchId: branchId as string,
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function getTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    const transfer = await transferService.getTransferById(String(req.params.id));
    res.json(transfer);
  } catch (error) {
    next(error);
  }
}

// ADMIN / OWNER → execute immediately and return the created transfer.
// STAFF          → create a pending approval request (stock moves only after approval).
export async function createTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    const userId   = req.user!.id;
    const userName = req.user!.name ?? "موظف";
    const role     = req.user!.role;
    const isAdmin  = role === UserRole.ADMIN;

    if (isAdmin) {
      const transfer = await transferService.createTransfer(req.body, userId);
      return res.status(201).json({
        success: true,
        message: "تم تنفيذ التحويل فوراً",
        transfer,
      });
    }

    // Staff: queue for approval
    const result = await transferService.createTransferRequest(req.body, userId, userName);
    return res.status(201).json({
      success: true,
      message: "تم إرسال طلب التحويل للموافقة",
      approvalId: result.approvalId,
      snapshot: result.snapshot,
    });
  } catch (error) {
    next(error);
  }
}
