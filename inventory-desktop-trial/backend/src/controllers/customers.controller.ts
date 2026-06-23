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
} from "../services/customer.service";
import { hasPermission } from "../middleware/permission.middleware";
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
  const result = await listCustomers(
    req.validatedQuery as Parameters<typeof listCustomers>[0]
  );

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
  const { tags, productIds, message } = req.body as {
    tags: string[]; productIds: string[]; message: string;
  };
  const recipients = await listCustomers({ tags, page: 1, limit: 1 });
  const total = recipients.pagination.total;
  // Respond immediately; the actual send is throttled and slow.
  res.json({ success: true, message: `جارٍ الإرسال إلى ${total} زبون`, data: { total } });
  setImmediate(() => {
    broadcastToCustomers({ tags, productIds, message })
      .then((r) => logger.info(`[CustomerBroadcast] done: ${r.sent}/${r.total} sent, ${r.failed} failed, ${r.skippedProducts} products skipped (no image)`))
      .catch((err) => logger.error(`[CustomerBroadcast] error: ${err}`));
  });
});
