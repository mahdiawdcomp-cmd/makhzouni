import { Request, Response, NextFunction } from "express";
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

// Employees submit a transfer REQUEST — it does not move stock until an
// authorized user approves it from the approvals page.
export async function createTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const userName = req.user!.name ?? "موظف";
    const result = await transferService.createTransferRequest(req.body, userId, userName);
    res.status(201).json({
      success: true,
      message: "تم إرسال طلب التحويل للموافقة",
      approvalId: result.approvalId,
      snapshot: result.snapshot,
    });
  } catch (error) {
    next(error);
  }
}
