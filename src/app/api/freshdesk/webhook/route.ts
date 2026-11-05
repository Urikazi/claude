import { timingSafeEqual } from "node:crypto";
import { after, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handleTicket } from "@/lib/support/handle-ticket";

export const dynamic = "force-dynamic";
/// The reply is written after Freshdesk has its answer, inside this window.
export const maxDuration = 300;

/**
 * Called by a Freshdesk automation whenever a customer writes in.
 *
 * Answers at once and does the work afterwards: Freshdesk gives a webhook a few seconds,
 * and reading the thread, looking up orders and drafting a reply takes longer than
 * that. A retry of the same event is harmless — handleTicket keys on the message.
 *
 * Each store has its own secret, sent as a bearer token. A store without one, or with
 * replies switched off, refuses rather than running unauthenticated.
 */
export async function POST(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get("store");
  if (!storeId) return Response.json({ error: "Missing ?store=" }, { status: 400 });

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, freshdeskWebhookSecret: true, freshdeskMode: true },
  });
  const header = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const token = header || request.nextUrl.searchParams.get("token") || "";
  if (!store?.freshdeskWebhookSecret || !safeEquals(token, store.freshdeskWebhookSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (store.freshdeskMode === "off") {
    return Response.json({ ok: true, skipped: "Replies are switched off for this store." });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  // Freshdesk placeholders arrive as strings, sometimes nested under "freshdesk_webhook".
  const nested = (body?.freshdesk_webhook ?? body) as Record<string, unknown> | undefined;
  const ticketId = Number.parseInt(String(nested?.ticket_id ?? ""), 10);
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return Response.json(
      { error: 'Send a JSON body like {"ticket_id": "{{ticket.id}}"}.' },
      { status: 400 },
    );
  }

  after(async () => {
    try {
      await handleTicket({ storeId: store.id, ticketId, trigger: "webhook" });
    } catch (error) {
      // Failures after the claim are recorded on the row; this catches the ones before
      // it (Freshdesk unreachable, ticket deleted), which have nowhere else to go.
      console.error(`Freshdesk ticket ${ticketId}:`, error);
    }
  });

  return Response.json({ ok: true, ticketId }, { status: 202 });
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
