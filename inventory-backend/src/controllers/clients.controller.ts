import { Request, Response, NextFunction } from "express";
import {
  createClient,
  deleteClient,
  listClients,
  revokeClient,
  updateClient,
} from "../services/clients.service";
import { AppError } from "../utils/app-error";

export async function getClients(req: Request, res: Response, next: NextFunction) {
  try {
    const clients = await listClients();
    res.json({ success: true, data: clients });
  } catch (err) { next(err); }
}

export async function postClient(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, months, notes, contactPhone, contactEmail } = req.body as {
      name?: string; months?: number; notes?: string;
      contactPhone?: string; contactEmail?: string;
    };
    if (!name?.trim()) throw new AppError("اسم العميل مطلوب", 400, "VALIDATION_ERROR");
    const m = Number(months);
    if (!m || m < 1 || m > 240) throw new AppError("المدة بين 1 و 240 شهر", 400, "VALIDATION_ERROR");
    const client = await createClient({ name: name.trim(), months: m, notes, contactPhone, contactEmail });
    res.status(201).json({ success: true, data: client });
  } catch (err) { next(err); }
}

export async function patchClient(req: Request, res: Response, next: NextFunction) {
  try {
    const { backendUrl, frontendUrl, contactPhone, contactEmail, notes } = req.body as {
      backendUrl?: string; frontendUrl?: string;
      contactPhone?: string; contactEmail?: string; notes?: string;
    };
    const client = await updateClient(req.params.id as string, {
      backendUrl, frontendUrl, contactPhone, contactEmail, notes,
    });
    res.json({ success: true, data: client });
  } catch (err) { next(err); }
}

export async function patchRevokeClient(req: Request, res: Response, next: NextFunction) {
  try {
    await revokeClient(req.params.id as string);
    res.json({ success: true, message: "تم إلغاء الترخيص" });
  } catch (err) { next(err); }
}

export async function deleteClientHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteClient(req.params.id as string);
    res.json({ success: true, message: "تم الحذف" });
  } catch (err) { next(err); }
}
