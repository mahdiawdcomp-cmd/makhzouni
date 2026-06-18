import { Response } from "express";

export type RealtimeResource =
  | "all"
  | "approvals"
  | "audit-logs"
  | "branches"
  | "catalog"
  | "coupons"
  | "customers"
  | "invoices"
  | "notifications"
  | "order-preparations"
  | "products"
  | "quotations"
  | "reports"
  | "settings"
  | "stocktake"
  | "transfers"
  | "users"
  | "vouchers";

export interface RealtimeEvent {
  id: string;
  type: "connected" | "changed";
  resource: RealtimeResource;
  action?: string;
  path?: string;
  at: string;
}

type Client = {
  id: string;
  userId: string;
  res: Response;
};

const clients = new Map<string, Client>();
let nextEventId = 1;

function writeEvent(res: Response, event: RealtimeEvent) {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function addRealtimeClient(userId: string, res: Response) {
  const id = `${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const client = { id, userId, res };
  clients.set(id, client);

  writeEvent(res, {
    id: String(nextEventId++),
    type: "connected",
    resource: "all",
    at: new Date().toISOString(),
  });

  return () => {
    clients.delete(id);
  };
}

export function publishRealtimeChange(input: Omit<RealtimeEvent, "id" | "type" | "at">) {
  if (clients.size === 0) return;

  const event: RealtimeEvent = {
    id: String(nextEventId++),
    type: "changed",
    resource: input.resource,
    action: input.action,
    path: input.path,
    at: new Date().toISOString(),
  };

  for (const client of clients.values()) {
    try {
      writeEvent(client.res, event);
    } catch {
      clients.delete(client.id);
    }
  }
}

export function realtimeHeartbeat() {
  for (const client of clients.values()) {
    try {
      client.res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      clients.delete(client.id);
    }
  }
}

