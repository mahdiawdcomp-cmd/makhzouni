import { UserRole } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  approvalRequestTypes,
  createPendingApproval,
} from "../services/approval.service";
import {
  createCustomer,
  getCustomerBalance,
  getCustomerById,
  getCustomerTransactions,
  getLastCustomerTransaction,
  listCustomers,
  listCustomersWithDebts,
  listInactiveCustomers,
  softDeleteCustomer,
  updateCustomer,
} from "../services/customer.service";
import { hasPermission } from "../middleware/permission.middleware";

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

  res.json({
    success: true,
    data: customer,
  });
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
