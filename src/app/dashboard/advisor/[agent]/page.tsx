import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveStore } from "@/lib/store";
import { AdvisorChat } from "@/components/advisor-chat";
import { Card } from "@/components/ui";
import { RangePicker } from "@/components/range-picker";
import { DailyPnlTable } from "@/components/daily-pnl-table";
import { LedgerUploadForm } from "@/components/ledger-upload-form";
import { describeAdvisorApiKey } from "@/lib/advisor/api-key";
import { advisorAvailableFor, findAdvisorAgent } from "@/lib/advisor/agents";
import { getAdvisorModel } from "@/lib/advisor/models";
import { formatMoney, resolveRange } from "@/lib/format";
import { buildPnlReport, calendarBounds } from "@/lib/pnl";

export const dynamic = "force-dynamic";

export default async function AdvisorPage({
  params,
  searchParams,
}: {
  params: Promise<{ agent: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const { agent: key } = await params;
  const agent = findAdvisorAgent(key);
  if (!agent) notFound();

  const store = await getActiveStore();
  if (!advisorAvailableFor(agent, store.name)) notFound();

  const [keySource, model, turns] = await Promise.all([
    describeAdvisorApiKey(),
    getAdvisorModel(),
    prisma.advisorMessage.findMany({
      where: { storeId: store.id, agent: agent.key },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
  ]);

  // The daily profit sheet belongs to the CFO: it is the figure the CFO reasons from,
  // set out one day a row so a bad day can be seen before it is asked about.
  const query = await searchParams;
  const sheet = agent.key === "cfo" ? await loadDailySheet(store, query) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{agent.label}</h1>
        <p className="mt-0.5 text-sm text-muted">{agent.blurb}</p>
        <p className="mt-1 text-xs text-muted">
          Running on {model.label}.{" "}
          <Link href="/dashboard/settings" className="underline">
            Change the model
          </Link>
        </p>
      </div>

      {sheet ? (
        <>
          <Card title="Daily profit">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <RangePicker />
              <a href={sheet.downloadHref} className="text-xs text-muted underline">
                Download CSV · {sheet.label}
              </a>
            </div>
            <DailyPnlTable
              daily={[...sheet.report.daily].reverse()}
              totals={sheet.report.totals}
              currency={store.currency}
            />
            <div className="mt-4 space-y-1 text-xs text-muted">
              <p>
                COGS is what the supplier billed wherever the ledger covers an order, and the
                price-list estimate where it does not yet — marked under each figure. Revenue is
                net of refunds; fees are payment processing plus Shopify&rsquo;s; profit is after
                ad spend.
              </p>
              {sheet.lastBill ? (
                <p>
                  Ledger imported through <strong>{sheet.lastBill}</strong>
                  {sheet.importedAt ? `, last uploaded ${sheet.importedAt}` : ""}.
                </p>
              ) : (
                <p>No supplier ledger imported yet, so every COGS figure is an estimate.</p>
              )}
              {sheet.unassigned !== 0 ? (
                <p>
                  Not in this table: {formatMoney(sheet.unassigned, store.currency)} of supplier
                  lines over these days that the ledger ties to no store — sample shipping,
                  packaging, cancellation credits.
                </p>
              ) : null}
            </div>
          </Card>

          <Card title="Supplier ledger">
            <LedgerUploadForm storeId={store.id} storeName={store.name} />
          </Card>
        </>
      ) : null}

      <Card>
        <AdvisorChat
          storeId={store.id}
          storeName={store.name}
          agent={agent.key}
          agentLabel={agent.label}
          suggestions={agent.suggestions}
          days={agent.days}
          configured={keySource !== "missing"}
          initial={turns.map((turn) => ({
            id: turn.id,
            role: turn.role,
            content: turn.content,
          }))}
        />
      </Card>
    </div>
  );
}

async function loadDailySheet(
  store: { id: string; timezone: string },
  query: { range?: string; from?: string; to?: string },
) {
  const range = resolveRange(query.range, query.from, query.to, store.timezone);
  const [report, lastBill, unassigned] = await Promise.all([
    buildPnlReport(store.id, range),
    prisma.supplierLedgerEntry.findFirst({
      where: { storeId: store.id, kind: "bill" },
      orderBy: { date: "desc" },
      select: { date: true, createdAt: true },
    }),
    prisma.supplierLedgerEntry.aggregate({
      where: { storeId: null, kind: { in: ["credit", "charge"] }, date: calendarBounds(range) },
      _sum: { amount: true },
    }),
  ]);

  const download = new URLSearchParams();
  if (query.from || query.to) {
    if (query.from) download.set("from", query.from);
    if (query.to) download.set("to", query.to);
  } else if (query.range) {
    download.set("range", query.range);
  }

  return {
    report,
    label: range.label,
    downloadHref: `/api/pnl/daily${download.size ? `?${download}` : ""}`,
    lastBill: lastBill?.date.toISOString().slice(0, 10) ?? null,
    importedAt: lastBill?.createdAt.toISOString().slice(0, 16).replace("T", " ") ?? null,
    unassigned: unassigned._sum.amount ?? 0,
  };
}
