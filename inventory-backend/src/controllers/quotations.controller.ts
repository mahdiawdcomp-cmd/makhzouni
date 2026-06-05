import {
  convertQuotationToInvoice,
  createQuotation,
  getQuotation,
  listQuotations,
  updateQuotationStatus,
} from "../services/quotation.service";
import { AppError } from "../utils/app-error";
import { asyncHandler } from "../utils/async-handler";

function requireUser(user: Express.User | undefined) {
  if (!user) throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  return user;
}

export const getQuotations = asyncHandler(async (req, res) => {
  const result = await listQuotations(req.validatedQuery as Parameters<typeof listQuotations>[0]);
  res.json({ success: true, ...result });
});

export const getQuotationDetails = asyncHandler(async (req, res) => {
  const data = await getQuotation(String(req.params.id));
  res.json({ success: true, data });
});

export const addQuotation = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const data = await createQuotation(req.body, user.id);
  res.status(201).json({ success: true, data });
});

export const editQuotationStatus = asyncHandler(async (req, res) => {
  const data = await updateQuotationStatus(String(req.params.id), req.body.status);
  res.json({ success: true, data });
});

export const convertQuotation = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const data = await convertQuotationToInvoice(String(req.params.id), user.id);
  res.json({ success: true, data });
});
