import { UserRole } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  approvalRequestTypes,
  createPendingApproval,
} from "../services/approval.service";
import {
  broadcastToCustomers,
  createCustomer,
  getCustomerBalance,
  getCustomerById,
  getCustomerByIdAny,
  getCustomerTransactions,
  getLastCustomerTransaction,
  getOrCreateWalkInCustomer,
  broadcastCatalogLink,
  createCustomerTag,
  deleteCustomerTag,
  listCustomers,
  listCustomersWithDebts,
  listCustomerTags,
  renameCustomerTag,
  sendCatalogLinkToCustomer,
  listInactiveCustomers,
  softDeleteCustomer,
  updateCustomer,
  recalculateCustomerBalance,
  getDeletedCustomers,
  restoreCustomer,
} from "../services/customer.service";
import { generateCustomerStatementPdf } from "../services/statement-export.service";
import { sendPdfWithTemplateFallback } from "../services/whatsapp.service";
import { getSettings } from "../services/settings.service";
import { hasPermission, salesAgentScopeFor } from "../middleware/permission.middleware";
import { logger } from "../utils/logger";

function requireUser(reqUser: Express.User | undefined) {
  if (!reqUser) {
    throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  }

  return reqUser;
}

async function queueStaffApproval(
  requestType:
    | "CREATE_CUSTOMER"
    | "UPDATE_CUSTOMER"
    | "DELETE_CUSTOMER",
  requestData: Record<string, unknown>,
  requestedBy: string
) {
  const approval = await createPendingApproval(
    approvalRequestTypes[requestType],
    requestData,
    requestedBy
  );

  return {
    success: true,
    message: "طلبك قيد المراجعة",
    approvalId: approval.id,
  };
}

export const getCustomers = asyncHandler(async (req, res) => {
  const result = await listCustomers({
    ...(req.validatedQuery as Parameters<typeof listCustomers>[0]),
    // «المندوب» — the scope comes from the token, so it cannot be widened by
    // editing the query string. Null for everyone else, which leaves the list
    // exactly as it was.
    salesAgentId: salesAgentScopeFor(req.user),
  });

  res.json({
    success: true,
    ...result,
  });
});

export const getCustomerDetails = asyncHandler(async (req, res) => {
  const customer = await getCustomerById(String(req.params.id));
  res.json({ success: true, data: customer });
});

/** Same as getCustomerDetails but includes soft-deleted customers (for account lookup) */
export const getCustomerDetailsAny = asyncHandler(async (req, res) => {
  const customer = await getCustomerByIdAny(String(req.params.id));
  res.json({ success: true, data: customer });
});

export const addCustomer = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_CUSTOMERS")) {
    const response = await queueStaffApproval(
      "CREATE_CUSTOMER",
      { body: req.body },
      user.id
    );
    res.status(202).json(response);
    return;
  }

  const customer = await createCustomer(req.body);

  res.status(201).json({
    success: true,
    message: "Customer created successfully",
    data: customer,
  });
});

export const editCustomer = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const id = String(req.params.id);

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_CUSTOMERS")) {
    const response = await queueStaffApproval(
      "UPDATE_CUSTOMER",
      { params: { id }, body: req.body },
      user.id
    );
    res.status(202).json(response);
    return;
  }

  const customer = await updateCustomer(id, req.body);

  res.json({
    success: true,
    message: "Customer updated successfully",
    data: customer,
  });
});

export const deleteCustomer = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const id = String(req.params.id);

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_CUSTOMERS")) {
    const response = await queueStaffApproval(
      "DELETE_CUSTOMER",
      { params: { id } },
      user.id
    );
    res.status(202).json(response);
    return;
  }

  const customer = await softDeleteCustomer(id);

  res.json({
    success: true,
    message: "Customer deleted successfully",
    data: customer,
  });
});

export const getDeletedCustomersList = asyncHandler(async (_req, res) => {
  const data = await getDeletedCustomers();
  res.json({ success: true, data });
});

export const restoreCustomerCtrl = asyncHandler(async (req, res) => {
  const customer = await restoreCustomer(String(req.params.id));
  res.json({ success: true, message: "تم استرجاع الزبون", data: customer });
});

export const getTransactions = asyncHandler(async (req, res) => {
  const result = await getCustomerTransactions(
    String(req.params.id),
    req.validatedQuery as Parameters<typeof getCustomerTransactions>[1]
  );

  res.json({
    success: true,
    data: result,
  });
});

export const getLastTransaction = asyncHandler(async (req, res) => {
  const transaction = await getLastCustomerTransaction(String(req.params.id));

  res.json({
    success: true,
    data: transaction,
  });
});

export const getBalance = asyncHandler(async (req, res) => {
  const balance = await getCustomerBalance(String(req.params.id));

  res.json({
    success: true,
    data: balance,
  });
});

// Generate the customer's account-statement PDF (all movements up to the given
// date, or the full history if none) and send it as a WhatsApp document.
export const sendStatementPdfWhatsapp = asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const date = typeof req.body?.date === "string" ? req.body.date : undefined;

  const [customer, settings] = await Promise.all([getCustomerById(id), getSettings()]);
  if (!customer.phone) {
    throw new AppError("رقم هاتف الزبون غير متوفر", 400, "CUSTOMER_PHONE_MISSING");
  }

  const pdf = await generateCustomerStatementPdf(id, date);
  const dateLabel = date ? new Date(date).toLocaleDateString("en-GB") : new Date().toLocaleDateString("en-GB");
  const currency = settings.currency ?? "د.ع";
  const caption = `كشف حساب ${customer.name} حتى ${dateLabel}`;
  const filename = `statement-${customer.name}.pdf`;

  // Tries the approved Meta document template first (survives the 24h window),
  // falls back to a plain PDF send. bodyParams order must match the template.
  const result = await sendPdfWithTemplateFallback(
    customer.phone,
    settings.statementPdfTemplateName,
    "ar",
    caption,
    pdf,
    filename,
    [customer.name, dateLabel, String(customer.currentBalance ?? 0), currency, settings.storeName],
    req.body?.channel === "official" || req.body?.channel === "personal" ? req.body.channel : undefined,
  );

  res.json({
    success: true,
    message: "تم إرسال كشف الحساب PDF عبر واتساب",
    data: result,
  });
});

export const getDebts = asyncHandler(async (_req, res) => {
  const debts = await listCustomersWithDebts();

  res.json({
    success: true,
    data: debts,
  });
});

export const getInactiveCustomers = asyncHandler(async (req, res) => {
  const { days } = req.validatedQuery as { days: number };
  const customers = await listInactiveCustomers(days);

  res.json({
    success: true,
    data: customers,
  });
});

export const getWalkInCustomer = asyncHandler(async (_req, res) => {
  const customer = await getOrCreateWalkInCustomer();
  res.json({ success: true, data: customer });
});

export const getCustomerTags = asyncHandler(async (_req, res) => {
  const tags = await listCustomerTags();
  res.json({ success: true, data: tags });
});

export const postCustomerTag = asyncHandler(async (req, res) => {
  const { name } = req.body as { name: string };
  const tags = await createCustomerTag(name);
  res.json({ success: true, data: tags });
});

export const patchCustomerTag = asyncHandler(async (req, res) => {
  const { oldName, newName } = req.body as { oldName: string; newName: string };
  const tags = await renameCustomerTag(oldName, newName);
  res.json({ success: true, data: tags });
});

export const deleteCustomerTagController = asyncHandler(async (req, res) => {
  const { name } = req.body as { name: string };
  const tags = await deleteCustomerTag(name);
  res.json({ success: true, data: tags });
});

export const postSendCatalogLink = asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const { promoCode } = req.body as { promoCode?: string };
  const result = await sendCatalogLinkToCustomer(id, promoCode);
  res.json({ success: true, message: `تم إرسال رابط الكتلوج إلى ${result.phone}`, data: result });
});

export const postCatalogLinkBroadcast = asyncHandler(async (req, res) => {
  const { tags, promoCode } = req.body as { tags: string[]; promoCode?: string };
  const recipients = await listCustomers({ tags, page: 1, limit: 1 });
  const total = recipients.pagination.total;
  // Respond immediately; the actual send is throttled and slow.
  res.json({ success: true, message: `جارٍ إرسال رابط الكتلوج إلى ${total} زبون`, data: { total } });
  setImmediate(() => {
    broadcastCatalogLink({ tags, promoCode })
      .then((r) => logger.info(`[CatalogLinkBroadcast] done: ${r.sent}/${r.total} sent, ${r.failed} failed`))
      .catch((err) => logger.error(`[CatalogLinkBroadcast] error: ${err}`));
  });
});

export const postCustomerBroadcast = asyncHandler(async (req, res) => {
  const { tags, customerIds, productIds, message } = req.body as {
    tags: string[]; customerIds: string[]; productIds: string[]; message: string;
  };
  const recipients = await listCustomers({ tags, customerIds, page: 1, limit: 1 });
  const total = recipients.pagination.total;
  // Respond immediately; the actual send is throttled and slow.
  res.json({ success: true, message: `جارٍ الإرسال إلى ${total} زبون`, data: { total } });
  setImmediate(() => {
    broadcastToCustomers({ tags, customerIds, productIds, message })
      .then((r) => logger.info(`[CustomerBroadcast] done: ${r.sent}/${r.total} sent, ${r.failed} failed, ${r.skippedProducts} products skipped (no image)`))
      .catch((err) => logger.error(`[CustomerBroadcast] error: ${err}`));
  });
});

export const recalculateBalance = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const customer = await recalculateCustomerBalance(id);
  res.json({ success: true, data: customer });
});
