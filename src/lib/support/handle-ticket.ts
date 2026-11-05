import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getAdvisorApiKey } from "@/lib/advisor/api-key";
import { getAdvisorModel } from "@/lib/advisor/models";
import { shopifyCredentials } from "@/lib/sync";
import * as freshdesk from "@/lib/integrations/freshdesk";
import { fetchOrdersByEmail, type SupportOrder } from "@/lib/integrations/shopify";
import { SUPPORT_SYSTEM_PROMPT, SupportDraftSchema, type SupportDraft } from "@/lib/support/prompt";
import { decide, parseSupportMode } from "@/lib/support/decide";

/**
 * Answers one Freshdesk ticket: reads the thread and the customer's orders, has Claude
 * write a reply, and either posts it as a private note for an agent or sends it.
 *
 * Two callers. The webhook runs it whenever Freshdesk reports a new customer message,
 * and honours the store's mode. The dashboard's "draft a reply" runs it on request and
 * only ever drafts — a person asking for a draft has not asked for an email to go out.
 */

export type HandleResult = {
  status: "note" | "reply" | "skipped" | "error" | "duplicate";
  message: string;
  replyId?: string;
};

/** Long enough for any real message; a pasted log or a forwarded chain is cut, and says so. */
const MAX_MESSAGE_CHARS = 6_000;
const MAX_THREAD_MESSAGES = 30;

const TAG_DRAFTED = "claude-draft";
const TAG_SENT = "claude-sent";

function clip(text: string | null | undefined): string {
  const value = (text ?? "").trim();
  if (value.length <= MAX_MESSAGE_CHARS) return value;
  return `${value.slice(0, MAX_MESSAGE_CHARS)}\n[… message truncated, ${value.length - MAX_MESSAGE_CHARS} more characters not shown]`;
}

function describeOrders(orders: SupportOrder[]): string {
  if (!orders.length) return "No orders found for this customer's email address.";
  return orders
    .map((order) => {
      const lines = [
        `Order ${order.name} — placed ${order.processedAt.slice(0, 10)}, total ${order.total}`,
        `  Payment: ${order.financialStatus ?? "unknown"}; fulfilment: ${order.fulfillmentStatus ?? "unknown"}${order.cancelledAt ? `; CANCELLED ${order.cancelledAt.slice(0, 10)}` : ""}`,
        `  Items: ${order.items.join(", ") || "none listed"}`,
      ];
      for (const fulfillment of order.fulfillments) {
        const tracking = fulfillment.tracking
          .map((t) => [t.company, t.number, t.url].filter(Boolean).join(" "))
          .filter(Boolean)
          .join("; ");
        lines.push(
          `  Shipment ${fulfillment.createdAt.slice(0, 10)}: ${fulfillment.status ?? "unknown"}${fulfillment.estimatedDeliveryAt ? `, estimated delivery ${fulfillment.estimatedDeliveryAt.slice(0, 10)}` : ""}${tracking ? `, tracking ${tracking}` : ", no tracking"}`,
        );
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function draftNoteHtml(draft: SupportDraft, reason: string): string {
  const header = `<p><strong>Claude draft</strong> · ${draft.category.replace(/_/g, " ")} · ${draft.confidence} confidence<br><em>${freshdesk
    .textToHtml(reason)
    .replace(/<\/?p>/g, " ")
    .trim()}</em></p><p>Review, then copy into a reply:</p><hr>`;
  return header + freshdesk.textToHtml(draft.reply);
}

export async function handleTicket(input: {
  storeId: string;
  ticketId: number;
  trigger: "webhook" | "manual";
}): Promise<HandleResult> {
  const { storeId, ticketId, trigger } = input;
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return { status: "error", message: "Unknown store." };
  if (!store.freshdeskDomain || !store.freshdeskApiKey) {
    return { status: "error", message: "Freshdesk is not connected for this store." };
  }
  const mode = trigger === "manual" ? "draft" : parseSupportMode(store.freshdeskMode);
  if (mode === "off") return { status: "skipped", message: "Freshdesk replies are switched off." };

  const credentials = { domain: store.freshdeskDomain, apiKey: store.freshdeskApiKey };
  const ticket = await freshdesk.getTicket(credentials, ticketId);
  const conversations = await freshdesk.getConversations(credentials, ticketId);

  // Private notes stay out of the thread Claude reads: they are internal, may hold
  // things never meant for the customer, and include our own earlier drafts.
  const publicThread = conversations.filter((message) => !message.private);
  const latest = publicThread.at(-1);
  if (trigger === "webhook" && latest && !latest.incoming) {
    return { status: "skipped", message: "The last message is from the store; nothing to answer." };
  }
  if (trigger === "webhook" && ticket.spam) {
    return { status: "skipped", message: "Ticket is marked as spam." };
  }

  const lastIncoming = [...publicThread].reverse().find((message) => message.incoming);
  const messageKey = lastIncoming ? String(lastIncoming.id) : "ticket";
  const requesterEmail = ticket.requester?.email ?? null;

  // Claim the message before doing anything slow. A second delivery of the same event
  // — a webhook retry, or our own note tripping an "updated" automation — finds the
  // row already there and stops here, which is what keeps this from looping.
  let replyId: string;
  const key = { storeId_ticketId_messageKey: { storeId, ticketId, messageKey } };
  if (trigger === "manual") {
    const row = await prisma.supportReply.upsert({
      where: key,
      create: { storeId, ticketId, messageKey, trigger, subject: ticket.subject, requesterEmail },
      update: { status: "pending", trigger, error: null, reason: null },
    });
    replyId = row.id;
  } else {
    try {
      const row = await prisma.supportReply.create({
        data: { storeId, ticketId, messageKey, trigger, subject: ticket.subject, requesterEmail },
      });
      replyId = row.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { status: "duplicate", message: "Already handled this message." };
      }
      throw error;
    }
  }

  try {
    const { key: apiKey } = await getAdvisorApiKey();
    if (!apiKey) throw new Error("No Claude API key is set. Add one under Store settings → Advisors.");

    let orderNote: string;
    if (!requesterEmail) {
      orderNote = "The requester has no email address, so no orders could be looked up.";
    } else {
      try {
        orderNote = describeOrders(await fetchOrdersByEmail(shopifyCredentials(store), requesterEmail));
      } catch (error) {
        // A reply without order data is still worth drafting; the model is told why
        // the data is missing so it asks rather than guesses.
        orderNote = `Order lookup unavailable (${error instanceof Error ? error.message : "unknown error"}). Do not state any order details.`;
      }
    }

    const thread = [
      { from: "Customer", at: ticket.created_at, text: ticket.description_text },
      ...publicThread.map((message) => ({
        from: message.incoming ? "Customer" : "Store",
        at: message.created_at,
        text: message.body_text,
      })),
    ];
    const shown = thread.slice(-MAX_THREAD_MESSAGES);
    const omitted = thread.length - shown.length;
    const transcript = [
      omitted > 0 ? `[${omitted} earlier messages not shown]` : "",
      ...shown.map((message) => `--- ${message.from}, ${message.at.slice(0, 16).replace("T", " ")} ---\n${clip(message.text)}`),
    ]
      .filter(Boolean)
      .join("\n\n");

    const model = await getAdvisorModel();
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.parse({
      model: model.id,
      max_tokens: 16_000,
      output_config: { effort: "medium", format: zodOutputFormat(SupportDraftSchema) },
      ...(model.serverSideFallback
        ? { betas: ["server-side-fallback-2026-07-01" as const], fallbacks: "default" as const }
        : {}),
      system: [{ type: "text", text: SUPPORT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `Store: ${store.name}

<store_policies>
${store.supportPolicies?.trim() || "No policies written. Do not state any policy; leave such questions to the agent."}
</store_policies>

<customer_orders>
${orderNote}
</customer_orders>

Customer: ${ticket.requester?.name ?? "unknown"} <${requesterEmail ?? "no email"}>
Subject: ${ticket.subject ?? "(no subject)"}

<ticket_thread>
${transcript}
</ticket_thread>

Draft the store's reply to the customer's latest message.`,
        },
      ],
    });

    if (response.stop_reason === "refusal") throw new Error("Claude declined to draft this reply.");
    const draft = response.parsed_output;
    if (!draft) throw new Error(`Claude's answer could not be read (stopped: ${response.stop_reason}).`);

    const customerText = [ticket.subject, ticket.description_text, lastIncoming?.body_text]
      .filter(Boolean)
      .join("\n");
    const decision = decide(mode, draft, customerText, { hasRequesterEmail: Boolean(requesterEmail) });

    if (decision.action === "reply") {
      await freshdesk.sendReply(credentials, ticketId, freshdesk.textToHtml(draft.reply));
      await freshdesk.addTags(credentials, ticket, [TAG_SENT]);
    } else if (decision.action === "note") {
      await freshdesk.addPrivateNote(credentials, ticketId, draftNoteHtml(draft, decision.reason));
      await freshdesk.addTags(credentials, ticket, [TAG_DRAFTED]);
    }

    const status = decision.action === "skip" ? "skipped" : decision.action;
    await prisma.supportReply.update({
      where: { id: replyId },
      data: {
        status,
        category: draft.category,
        confidence: draft.confidence,
        reason: decision.reason,
        body: draft.reply,
      },
    });
    return {
      status,
      replyId,
      message:
        status === "reply"
          ? `Sent a reply on ticket #${ticketId}.`
          : status === "note"
            ? `Draft added to ticket #${ticketId} as a private note.`
            : `No reply needed on ticket #${ticketId}: ${decision.reason}`,
    };
  } catch (error) {
    const message =
      error instanceof Anthropic.AuthenticationError
        ? "The Claude API key was rejected. Check it under Store settings."
        : error instanceof Error
          ? error.message
          : String(error);
    await prisma.supportReply.update({
      where: { id: replyId },
      data: { status: "error", error: message },
    });
    return { status: "error", message, replyId };
  }
}
