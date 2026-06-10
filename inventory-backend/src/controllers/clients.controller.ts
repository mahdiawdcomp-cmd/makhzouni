import { Request, Response, NextFunction } from "express";
import { createClient, deleteClient, listClients, revokeClient } from "../services/clients.service";
import { AppError } from "../utils/app-error";

export async function getClients(req: Request, res: Response, next: NextFunction) {
  try {
    const clients = await listClients();
    res.json({ success: true, data: clients });
  } catch (err) {
    next(err);
  }
}

export async function postClient(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, months, notes } = req.body as { name?: string; months?: number; notes?: string };
    if (!name?.trim()) throw new AppError("اسم العميل مطلوب", 400, "VALIDATION_ERROR");
    const m = Number(months);
    if (!m || m < 1 || m > 240) throw new AppError("مدة الترخيص يجب أن تكون بين 1 و 240 شهر", 400, "VALIDATION_ERROR");
    const client = await createClient(name.trim(), m, notes);
    res.status(201).json({ success: true, data: client });
  } catch (err) {
    next(err);
  }
}

export async function patchRevokeClient(req: Request, res: Response, next: NextFunction) {
  try {
    await revokeClient(req.params.id as string);
    res.json({ success: true, message: "تم إلغاء الترخيص" });
  } catch (err) {
    next(err);
  }
}

export async function deleteClientHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteClient(req.params.id as string);
    res.json({ success: true, message: "تم الحذف" });
  } catch (err) {
    next(err);
  }
}
