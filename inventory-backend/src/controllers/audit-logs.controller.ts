import { listAuditLogs } from "../services/audit-log.service";
import { asyncHandler } from "../utils/async-handler";

export const getAuditLogs = asyncHandler(async (req, res) => {
  const logs = await listAuditLogs(
    req.validatedQuery as Parameters<typeof listAuditLogs>[0]
  );

  res.json({
    success: true,
    ...logs,
  });
});
