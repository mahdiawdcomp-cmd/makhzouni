import { asyncHandler } from "../utils/async-handler";
import {
  createPersonalDebt,
  deletePersonalDebt,
  listPersonalDebts,
  markPersonalDebtPaid,
  updatePersonalDebt,
} from "../services/personal-debt.service";

export const getPersonalDebts = asyncHandler(async (_req, res) => {
  const debts = await listPersonalDebts();
  res.json({ success: true, data: debts });
});

export const postPersonalDebt = asyncHandler(async (req, res) => {
  const debt = await createPersonalDebt(req.body, req.user?.id);
  res.status(201).json({ success: true, data: debt });
});

export const putPersonalDebt = asyncHandler(async (req, res) => {
  const debt = await updatePersonalDebt(String(req.params.id), req.body);
  res.json({ success: true, data: debt });
});

export const putPersonalDebtPaid = asyncHandler(async (req, res) => {
  const debt = await markPersonalDebtPaid(String(req.params.id));
  res.json({ success: true, data: debt });
});

export const deletePersonalDebtHandler = asyncHandler(async (req, res) => {
  await deletePersonalDebt(String(req.params.id));
  res.json({ success: true, message: "تم حذف الدين" });
});
