import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// Fake prisma store — only the models/methods whatsapp-chat.service.ts touches.
let conversations: any[] = [];
let messages: any[] = [];
let customers: any[] = [];
let prospects: any[] = [];
let realtimeEvents: any[] = [];
let idCounter = 0;
const nextId = () => `id-${++idCounter}`;

const fakePrisma = {
  customer: {
    findUnique: async ({ where }: any) => customers.find((c) => c.phone === where.phone) ?? null,
  },
  prospect: {
    findUnique: async ({ where }: any) => prospects.find((p) => p.phone === where.phone) ?? null,
  },
  whatsappConversation: {
    findUnique: async ({ where }: any) => {
      if (where.phone) return conversations.find((c) => c.phone === where.phone) ?? null;
      if (where.id) return conversations.find((c) => c.id === where.id) ?? null;
      return null;
    },
    create: async ({ data }: any) => {
      // Column defaults from the schema. Without them a fresh conversation
      // came back with isPinned undefined, which the real database never
      // does — and that gap produced a failure that only appeared when the
      // clock happened to tick between two inserts.
      const row = { id: nextId(), isArchived: false, isPinned: false, unreadCount: 0, ...data };
      conversations.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = conversations.find((c) => c.id === where.id);
      if (!row) throw new Error("conversation not found");
      const patch: any = { ...data };
      if (patch.unreadCount && typeof patch.unreadCount === "object" && "increment" in patch.unreadCount) {
        patch.unreadCount = (row.unreadCount ?? 0) + patch.unreadCount.increment;
      }
      Object.assign(row, patch);
      return row;
    },
    findMany: async ({ where, take }: any) => {
      let rows = [...conversations];
      if (where?.isArchived === false) rows = rows.filter((r) => !r.isArchived);
      if (where?.OR) {
        rows = rows.filter((r) =>
          where.OR.some((cond: any) => {
            if (cond.phone) return String(r.phone).includes(cond.phone.contains);
            if (cond.contactName) return String(r.contactName ?? "").toLowerCase().includes(String(cond.contactName.contains).toLowerCase());
            return false;
          })
        );
      }
      rows.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
      return take ? rows.slice(0, take) : rows;
    },
    aggregate: async () => ({ _sum: { unreadCount: conversations.reduce((s, c) => s + (c.unreadCount ?? 0), 0) } }),
  },
  whatsappMessage: {
    findUnique: async ({ where }: any) => messages.find((m) => m.waMessageId === where.waMessageId) ?? null,
    create: async ({ data }: any) => {
      // Monotonic fake clock: real webhook/send calls are separated by network
      // latency, but this fixture can race within the same millisecond —
      // force strictly increasing timestamps so ordering assertions are deterministic.
      const row = { id: nextId(), createdAt: new Date(Date.now() + messages.length), ...data };
      messages.push(row);
      return row;
    },
    findMany: async ({ where, take }: any) => {
      let rows = messages.filter((m) => m.conversationId === where.conversationId);
      if (where.createdAt?.lt) rows = rows.filter((m) => m.createdAt < where.createdAt.lt);
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return take ? rows.slice(0, take) : rows;
    },
    update: async ({ where, data }: any) => {
      const row = messages.find((m) => m.id === where.id);
      if (!row) throw new Error("message not found");
      Object.assign(row, data);
      return row;
    },
    findFirst: async ({ where, orderBy }: any) => {
      let rows = messages.filter((m) => m.conversationId === where.conversationId);
      if (where.direction) rows = rows.filter((m) => m.direction === where.direction);
      if (orderBy?.createdAt === "desc") rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return rows[0] ?? null;
    },
  },
};

mock.module("../config/database", { exports: { default: fakePrisma } });
mock.module("./realtime.service", {
  exports: { publishRealtimeChange: (e: any) => { realtimeEvents.push(e); } },
});

let svc: typeof import("./whatsapp-chat.service");

describe("whatsapp-chat.service", () => {
  before(async () => {
    svc = await import("./whatsapp-chat.service");
  });

  beforeEach(() => {
    conversations = [];
    messages = [];
    customers = [];
    prospects = [];
    realtimeEvents = [];
    idCounter = 0;
  });

  it("creates a new conversation on first inbound message and increments unread", async () => {
    await svc.logChatMessage({ phone: "07701234567", direction: "IN", text: "هلا" });
    const convs = await svc.getConversations();
    assert.equal(convs.length, 1);
    assert.equal(convs[0].phone, "9647701234567");
    assert.equal(convs[0].unreadCount, 1);
  });

  it("resolves contact name + customerId from an existing customer", async () => {
    customers.push({ id: "c1", phone: "9647701234567", name: "أحمد" });
    await svc.logChatMessage({ phone: "9647701234567", direction: "IN", text: "مرحبا" });
    const convs = await svc.getConversations();
    assert.equal(convs[0].contactName, "أحمد");
    assert.equal(convs[0].customerId, "c1");
  });

  it("outbound message does not increment unread", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "OUT", text: "رد" });
    const convs = await svc.getConversations();
    assert.equal(convs[0].unreadCount, 0);
  });

  it("dedups inbound webhook retries by waMessageId", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "IN", text: "مرة اولى", waMessageId: "wamid.1" });
    await svc.logChatMessage({ phone: "9647701234567", direction: "IN", text: "مرة اولى", waMessageId: "wamid.1" });
    const { messages: msgs } = await svc.getMessages("9647701234567");
    assert.equal(msgs.length, 1);
  });

  it("markConversationRead resets unread count to 0", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "IN", text: "1" });
    await svc.logChatMessage({ phone: "9647701234567", direction: "IN", text: "2" });
    let convs = await svc.getConversations();
    assert.equal(convs[0].unreadCount, 2);
    await svc.markConversationRead("9647701234567");
    convs = await svc.getConversations();
    assert.equal(convs[0].unreadCount, 0);
  });

  it("getUnreadCount sums unread across conversations", async () => {
    await svc.logChatMessage({ phone: "9647701111111", direction: "IN", text: "a" });
    await svc.logChatMessage({ phone: "9647702222222", direction: "IN", text: "b" });
    await svc.logChatMessage({ phone: "9647702222222", direction: "IN", text: "c" });
    const count = await svc.getUnreadCount();
    assert.equal(count, 3);
  });

  it("markConversationRead throws for an unknown phone", async () => {
    await assert.rejects(() => svc.markConversationRead("9647709999999"));
  });

  it("getMessages returns the thread in ascending (chat) order", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "IN", text: "first" });
    await svc.logChatMessage({ phone: "9647701234567", direction: "OUT", text: "second" });
    const { messages: msgs } = await svc.getMessages("9647701234567");
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].text, "first");
    assert.equal(msgs[1].text, "second");
  });

  it("publishes a realtime whatsapp-chat event on every logged message", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "IN", text: "hi" });
    assert.equal(realtimeEvents.length, 1);
    assert.equal(realtimeEvents[0].resource, "whatsapp-chat");
  });

  it("ignores blank text without creating a conversation", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "IN", text: "   " });
    const convs = await svc.getConversations();
    assert.equal(convs.length, 0);
  });

  it("a media message with no caption falls back to a readable placeholder instead of being dropped", async () => {
    const msg = await svc.logChatMessage({
      phone: "9647701234567",
      direction: "IN",
      text: "",
      mediaType: "IMAGE",
      mediaDataUrl: "data:image/jpeg;base64,AAAA",
    });
    assert.ok(msg);
    assert.equal(msg.text, "📷 صورة");
    assert.equal(msg.mediaType, "IMAGE");
    const convs = await svc.getConversations();
    assert.equal(convs[0].lastMessageText, "📷 صورة");
  });

  it("a document fallback includes the filename when present", () => {
    assert.equal(svc.mediaFallbackText("DOCUMENT", "فاتورة.pdf"), "📄 فاتورة.pdf");
    assert.equal(svc.mediaFallbackText("DOCUMENT", null), "📄 مستند");
  });

  it("an unrecognized/future media type still gets a generic placeholder, never silently dropped", async () => {
    const msg = await svc.logChatMessage({ phone: "9647701234567", direction: "IN", text: "", mediaType: "SOMETHING_NEW" });
    assert.ok(msg);
    assert.equal(msg.text, "📎 مرفق");
  });

  it("getMessages reports hasMore=true when older messages remain beyond the page limit", async () => {
    for (let i = 0; i < 5; i++) {
      await svc.logChatMessage({ phone: "9647701234567", direction: "IN", text: `msg ${i}` });
    }
    const page = await svc.getMessages("9647701234567", { limit: 3 });
    assert.equal(page.messages.length, 3);
    assert.equal(page.hasMore, true);
    // newest 3 of the 5 (ascending order): msg 2, msg 3, msg 4
    assert.deepEqual(page.messages.map((m: any) => m.text), ["msg 2", "msg 3", "msg 4"]);
  });

  it("getMessages reports hasMore=false when the whole thread fits in one page", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "IN", text: "only one" });
    const page = await svc.getMessages("9647701234567", { limit: 50 });
    assert.equal(page.hasMore, false);
  });

  it("getMessages hasMore=false for a conversation that doesn't exist", async () => {
    const page = await svc.getMessages("9647709999998");
    assert.equal(page.hasMore, false);
    assert.equal(page.conversation, null);
  });

  it("updateMessageStatus walks the lifecycle SENT → DELIVERED → READ", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "OUT", text: "هلا", waMessageId: "wamid.1" });
    let m = await svc.updateMessageStatus("wamid.1", "delivered");
    assert.equal(m?.status, "DELIVERED");
    m = await svc.updateMessageStatus("wamid.1", "read");
    assert.equal(m?.status, "READ");
  });

  it("updateMessageStatus never downgrades READ back to DELIVERED (out-of-order webhook)", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "OUT", text: "هلا", waMessageId: "wamid.2" });
    await svc.updateMessageStatus("wamid.2", "read");
    const m = await svc.updateMessageStatus("wamid.2", "delivered");
    assert.equal(m?.status, "READ");
  });

  it("updateMessageStatus FAILED always applies and keeps the error reason", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "OUT", text: "هلا", waMessageId: "wamid.3" });
    await svc.updateMessageStatus("wamid.3", "read");
    const m = await svc.updateMessageStatus("wamid.3", "failed", "Message failed: 24h window closed");
    assert.equal(m?.status, "FAILED");
    assert.equal(m?.statusError, "Message failed: 24h window closed");
  });

  it("updateMessageStatus is a silent no-op for unknown waMessageId or status", async () => {
    assert.equal(await svc.updateMessageStatus("wamid.unknown", "delivered"), null);
    await svc.logChatMessage({ phone: "9647701234567", direction: "OUT", text: "هلا", waMessageId: "wamid.4" });
    assert.equal(await svc.updateMessageStatus("wamid.4", "weird_future_status"), null);
  });

  it("a status update publishes a realtime whatsapp-chat event", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "OUT", text: "هلا", waMessageId: "wamid.5" });
    realtimeEvents = [];
    await svc.updateMessageStatus("wamid.5", "delivered");
    assert.equal(realtimeEvents.length, 1);
    assert.equal(realtimeEvents[0].resource, "whatsapp-chat");
  });

  it("logChatMessage stores a reply-to snapshot resolved from the quoted message's text", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "IN", text: "السعر شكد؟", waMessageId: "wamid.q1" });
    const reply = await svc.logChatMessage({
      phone: "9647701234567",
      direction: "OUT",
      text: "5000 دينار",
      replyToWaMessageId: "wamid.q1",
    });
    assert.equal(reply?.replyToWaMessageId, "wamid.q1");
    assert.equal(reply?.replyToText, "السعر شكد؟");
  });

  it("logChatMessage leaves replyToText null when the quoted wa id is unknown", async () => {
    const reply = await svc.logChatMessage({
      phone: "9647701234567",
      direction: "IN",
      text: "رد على شي مو موجود",
      replyToWaMessageId: "wamid.missing",
    });
    assert.equal(reply?.replyToText, null);
  });

  it("applyMessageReaction attaches an emoji to the target message and publishes realtime", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "OUT", text: "هلا", waMessageId: "wamid.r1" });
    realtimeEvents = [];
    const updated = await svc.applyMessageReaction("wamid.r1", "👍");
    assert.equal(updated?.reactionEmoji, "👍");
    assert.equal(realtimeEvents[0]?.resource, "whatsapp-chat");
  });

  it("applyMessageReaction with a falsy emoji removes the reaction", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "OUT", text: "هلا", waMessageId: "wamid.r2" });
    await svc.applyMessageReaction("wamid.r2", "❤️");
    const cleared = await svc.applyMessageReaction("wamid.r2", null);
    assert.equal(cleared?.reactionEmoji, null);
  });

  it("applyMessageReaction is a silent no-op for an unknown waMessageId", async () => {
    assert.equal(await svc.applyMessageReaction("wamid.unknown", "👍"), null);
  });

  it("fillConversationContactName sets the name only when the conversation has none yet", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "IN", text: "هلا" });
    await svc.fillConversationContactName("9647701234567", "زبون من ميتا");
    let convs = await svc.getConversations();
    assert.equal(convs[0].contactName, "زبون من ميتا");

    await svc.fillConversationContactName("9647701234567", "اسم ثاني");
    convs = await svc.getConversations();
    assert.equal(convs[0].contactName, "زبون من ميتا"); // customer/prospect match still wins, first name sticks
  });

  it("setConversationArchived hides a conversation from the default list and restores it", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "IN", text: "هلا" });
    await svc.setConversationArchived("9647701234567", true);
    assert.equal((await svc.getConversations()).length, 0);
    assert.equal((await svc.getConversations(undefined, { includeArchived: true })).length, 1);
    await svc.setConversationArchived("9647701234567", false);
    assert.equal((await svc.getConversations()).length, 1);
  });

  it("setConversationArchived throws for an unknown phone", async () => {
    await assert.rejects(() => svc.setConversationArchived("9647709999999", true));
  });

  it("setConversationPinned sorts pinned conversations to the top", async () => {
    await svc.logChatMessage({ phone: "9647701111111", direction: "IN", text: "a" });
    await svc.logChatMessage({ phone: "9647702222222", direction: "IN", text: "b" });
    await svc.setConversationPinned("9647701111111", true);
    const convs = await svc.getConversations();
    assert.equal(convs[0].phone, "9647701111111");
  });

  // The regression this file kept hitting: a conversation whose isPinned the
  // store never set came back undefined, Number(undefined) is NaN, and a NaN
  // comparator makes sort keep the original order — so pinning did nothing.
  it("keeps a pinned conversation on top even when isPinned is missing", async () => {
    await svc.logChatMessage({ phone: "9647703333333", direction: "IN", text: "a" });
    await svc.setConversationPinned("9647703333333", true);
    await svc.logChatMessage({ phone: "9647704444444", direction: "IN", text: "b" });
    for (const c of conversations) {
      if (c.phone !== "9647704444444") continue;
      // Simulate a row from before the column had a default...
      delete c.isPinned;
      // ...and make it unambiguously the more recent one, so it sorts first
      // before the pinned pass runs. Without this the two timestamps can land
      // in the same millisecond and a stable sort hides the bug — which is
      // exactly why the original failure only appeared some runs.
      c.lastMessageAt = new Date(c.lastMessageAt.getTime() + 60_000);
    }

    const convs = await svc.getConversations();
    const pinnedAt = convs.findIndex((c: any) => c.phone === "9647703333333");
    const otherAt = convs.findIndex((c: any) => c.phone === "9647704444444");
    assert.ok(pinnedAt < otherAt, "pinned conversation must sort above the unpinned one");
  });

  it("setConversationNotes trims and stores staff-only notes, blank clears them", async () => {
    await svc.logChatMessage({ phone: "9647701234567", direction: "IN", text: "هلا" });
    const withNote = await svc.setConversationNotes("9647701234567", "  زبون VIP  ");
    assert.equal(withNote.internalNotes, "زبون VIP");
    const cleared = await svc.setConversationNotes("9647701234567", "   ");
    assert.equal(cleared.internalNotes, null);
  });
});
