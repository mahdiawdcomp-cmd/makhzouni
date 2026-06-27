import { InboundMessageStatus } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import {
  listInboundMessages,
  markInboundMessageRead,
  replyToInboundMessage,
} from "../services/inbound-message.service";

export const getInboundMessages = asyncHandler(async (req, res) => {
  const statusRaw = String(req.query.status ?? "").toUpperCase();
  const status = statusRaw in InboundMessageStatus ? (statusRaw as InboundMessageStatus) : undefined;
  const data = await listInboundMessages({ status });
  res.json({ success: true, data });
});

export const patchInboundMessageRead = asyncHandler(async (req, res) => {
  const data = await markInboundMessageRead(String(req.params.id));
  res.json({ success: true, data });
});

export const postInboundMessageReply = asyncHandler(async (req, res) => {
  const data = await replyToInboundMessage(String(req.params.id), String(req.body?.text ?? ""));
  res.json({ success: true, data });
});
