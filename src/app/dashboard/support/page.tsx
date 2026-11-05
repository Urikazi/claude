import Link from "next/link";
import { prisma } from "@/lib/db";
import { getActiveStore } from "@/lib/store";
import { formatDate } from "@/lib/format";
import { normalizeFreshdeskDomain } from "@/lib/integrations/freshdesk";
import { parseSupportMode } from "@/lib/support/decide";
import { Card, Empty, Stat, Td, Th } from "@/components/ui";
import { DraftTicketForm } from "@/components/draft-ticket-form";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; className: string }> = {
  reply: { label: "Sent", className: "text-pos" },
  note: { label: "Drafted", className: "text-accent" },
  skipped: { label: "No reply needed", className: "text-muted" },
  pending: { label: "Working…", className: "text-muted" },
  error: { label: "Failed", className: "text-neg" },
};

const MODE_LABEL = {
  off: "Off — drafts on request only",
  draft: "Drafts only",
  auto: "Sends routine replies, drafts the rest",
};

/** Start of the window the counts cover. Read per request; the page is dynamic. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export default async function SupportPage() {
  const store = await getActiveStore();
  const mode = parseSupportMode(store.freshdeskMode);
  const connected = Boolean(store.freshdeskDomain && store.freshdeskApiKey);
  const host = store.freshdeskDomain ? normalizeFreshdeskDomain(store.freshdeskDomain) : null;

  const since = daysAgo(30);
  const [replies, counts] = await Promise.all([
    prisma.supportReply.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.supportReply.groupBy({
      by: ["status"],
      where: { storeId: store.id, createdAt: { gte: since } },
      _count: true,
    }),
  ]);
  const count = (status: string) => counts.find((row) => row.status === status)?._count ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Support replies</h1>
        <p className="mt-0.5 text-sm text-muted">
          Claude reads each Freshdesk ticket with the customer&rsquo;s orders and your policies, then
          drafts a reply or sends it. Mode: {MODE_LABEL[mode]}.{" "}
          <Link href="/dashboard/settings" className="text-accent underline">
            Change in settings
          </Link>
        </p>
      </div>

      {!connected ? (
        <Card>
          <Empty>
            Connect Freshdesk under{" "}
            <Link href="/dashboard/settings" className="text-accent underline">
              Store settings → Freshdesk replies
            </Link>{" "}
            to start.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label="Sent (30 days)" value={String(count("reply"))} />
            <Stat label="Drafted (30 days)" value={String(count("note"))} />
            <Stat label="No reply needed" value={String(count("skipped"))} />
            <Stat label="Failed" value={String(count("error"))} />
          </div>

          <Card title="Draft a reply now">
            <p className="mb-3 text-xs text-muted">
              Adds a draft to the ticket as a private note. Never emails the customer, whatever the
              mode. Running it again on the same message replaces the record here.
            </p>
            <DraftTicketForm storeId={store.id} />
          </Card>

          <Card title="Recent tickets">
            {replies.length === 0 ? (
              <Empty>No tickets handled yet.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead>
                    <tr>
                      <Th>When</Th>
                      <Th>Ticket</Th>
                      <Th>Outcome</Th>
                      <Th>Category</Th>
                      <Th>Why</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {replies.map((reply) => {
                      const status = STATUS[reply.status] ?? STATUS.pending;
                      return (
                        <tr key={reply.id} className="align-top">
                          <Td>{formatDate(reply.createdAt)}</Td>
                          <Td>
                            <a
                              href={`https://${host}/a/tickets/${reply.ticketId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent underline"
                            >
                              #{reply.ticketId}
                            </a>
                            <div className="max-w-56 truncate text-xs text-muted">
                              {reply.subject ?? ""}
                            </div>
                          </Td>
                          <Td>
                            <span className={status.className}>{status.label}</span>
                            {reply.trigger === "manual" ? (
                              <div className="text-xs text-muted">on request</div>
                            ) : null}
                          </Td>
                          <Td className="text-muted">
                            {reply.category?.replace(/_/g, " ") ?? "—"}
                            {reply.confidence ? (
                              <div className="text-xs">{reply.confidence} confidence</div>
                            ) : null}
                          </Td>
                          <Td className="max-w-md text-muted">
                            {reply.error ?? reply.reason ?? "—"}
                            {reply.body ? (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-xs text-accent">
                                  Reply text
                                </summary>
                                <p className="mt-1 whitespace-pre-wrap text-xs text-body">
                                  {reply.body}
                                </p>
                              </details>
                            ) : null}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
