import { prisma } from "@/lib/db";
import { getActiveStore } from "@/lib/store";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { Card, Empty, Stat, Td, Th } from "@/components/ui";
import { InvoiceUploadForm } from "@/components/invoice-upload-form";
import { DeleteInvoiceButton } from "@/components/delete-invoice-button";

export const dynamic = "force-dynamic";

const VERDICTS: Record<string, { label: string; className: string }> = {
  overcharged: { label: "Over the quote", className: "text-neg" },
  undercharged: { label: "Under the quote", className: "text-pos" },
  "no-country-quote": { label: "No quote for this country", className: "text-muted" },
  unpriced: { label: "SKU not in the price list", className: "text-muted" },
};

export default async function InvoicesPage() {
  const store = await getActiveStore();

  const invoices = await prisma.supplierInvoice.findMany({
    where: { storeId: store.id },
    orderBy: { uploadedAt: "desc" },
    take: 60,
  });

  const latest = invoices[0];
  // Only the lines worth reading: what matched is the majority and says nothing.
  const flagged = latest
    ? await prisma.supplierInvoiceLine.findMany({
        where: { invoiceId: latest.id, verdict: { not: "ok" } },
        orderBy: [{ variance: "desc" }, { orderRef: "asc" }],
        take: 200,
      })
    : [];

  const currency = store.currency;
  const checked = invoices.filter((invoice) => invoice.totalExpected > 0);
  const runningVariance = checked.reduce((sum, invoice) => sum + invoice.variance, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Supplier invoices</h1>
        <p className="mt-0.5 text-sm text-muted">
          Upload what your supplier bills and every line is priced against your agreed
          price list.
        </p>
      </div>

      <Card title="Check an invoice">
        <InvoiceUploadForm storeId={store.id} />
      </Card>

      {latest ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Billed on this invoice"
              value={formatMoney(latest.totalCharged, currency)}
              hint={`${formatNumber(latest.billedLines)} billed lines`}
            />
            <Stat
              label="Your price list says"
              value={formatMoney(latest.totalExpected, currency)}
              hint="Same lines, quoted rates"
            />
            <Stat
              label="Difference"
              value={`${latest.variance >= 0 ? "+" : "−"}${formatMoney(Math.abs(latest.variance), currency)}`}
              tone={latest.variance > 0.01 ? "negative" : "positive"}
              hint={
                latest.variance > 0.01
                  ? `${latest.overchargedCount} line${latest.overchargedCount === 1 ? "" : "s"} over the quote`
                  : "Every quoted line matches"
              }
            />
            <Stat
              label="Not checked"
              value={formatNumber(latest.unquotedCount)}
              hint="Lines your price list does not cover"
            />
          </div>

          <Card
            title={`${latest.filename} · ${latest.invoiceDate ? formatDate(latest.invoiceDate) : "no date"}`}
            action={<DeleteInvoiceButton id={latest.id} label={latest.filename} />}
          >
            {latest.statedTotal !== null &&
            Math.abs(latest.lineSum - latest.statedTotal) > 0.011 ? (
              <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
                The invoice states a total of{" "}
                {formatMoney(latest.statedTotal, currency)} but its own lines add up to{" "}
                {formatMoney(latest.lineSum, currency)} — a difference of{" "}
                {formatMoney(Math.abs(latest.lineSum - latest.statedTotal), currency)}. Worth
                asking about before anything else on this page.
              </p>
            ) : null}

            {flagged.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] border-collapse text-sm">
                  <thead>
                    <tr>
                      <Th>Order</Th>
                      <Th>Item</Th>
                      <Th align="right">Qty</Th>
                      <Th align="right">Billed</Th>
                      <Th align="right">Quoted</Th>
                      <Th align="right">Difference</Th>
                      <Th>Reading</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {flagged.map((line) => {
                      const verdict = VERDICTS[line.verdict] ?? {
                        label: line.verdict,
                        className: "text-muted",
                      };
                      return (
                        <tr key={line.id}>
                          <Td>
                            <span className="block">{line.orderRef}</span>
                            <span className="text-[11px] text-muted">{line.country}</span>
                          </Td>
                          <Td>
                            <span className="block max-w-xs truncate">{line.product}</span>
                            <span className="text-[11px] text-muted">{line.sku}</span>
                          </Td>
                          <Td align="right">{line.quantity}</Td>
                          <Td align="right" className="tabular-nums">
                            {formatMoney(line.charged, currency)}
                          </Td>
                          <Td align="right" className="tabular-nums">
                            {line.expected === null ? "—" : formatMoney(line.expected, currency)}
                          </Td>
                          <Td align="right">
                            {line.expected === null ? (
                              <span className="text-muted">—</span>
                            ) : (
                              <span
                                className={`tabular-nums ${line.variance > 0 ? "text-neg" : "text-pos"}`}
                              >
                                {line.variance >= 0 ? "+" : "−"}
                                {formatMoney(Math.abs(line.variance), currency)}
                              </span>
                            )}
                          </Td>
                          <Td>
                            <span className={`text-xs ${verdict.className}`}>
                              {verdict.label}
                            </span>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>
                Every billed line matches your price list exactly.
              </Empty>
            )}

            <p className="mt-4 text-xs text-muted">
              A line is checked only where your price list quotes that SKU for that
              destination. A product quoted at one rate everywhere — a sponge, a brush — is
              checked wherever it ships; one quoted country by country is left alone in a
              country it says nothing about, since the only comparison available would be
              against a price nobody agreed for it.
            </p>
          </Card>
        </>
      ) : null}

      <Card title={`Checked so far · ${invoices.length}`}>
        {invoices.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <thead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th align="right">Lines</Th>
                    <Th align="right">Billed</Th>
                    <Th align="right">Quoted</Th>
                    <Th align="right">Difference</Th>
                    <Th align="right">{""}</Th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <Td>
                        <span className="block">
                          {invoice.invoiceDate ? formatDate(invoice.invoiceDate) : "—"}
                        </span>
                        <span className="text-[11px] text-muted">{invoice.filename}</span>
                      </Td>
                      <Td align="right">{formatNumber(invoice.billedLines)}</Td>
                      <Td align="right" className="tabular-nums">
                        {formatMoney(invoice.totalCharged, currency)}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {formatMoney(invoice.totalExpected, currency)}
                      </Td>
                      <Td align="right">
                        <span
                          className={`tabular-nums ${
                            invoice.variance > 0.01
                              ? "text-neg"
                              : invoice.variance < -0.01
                                ? "text-pos"
                                : "text-muted"
                          }`}
                        >
                          {invoice.variance >= 0 ? "+" : "−"}
                          {formatMoney(Math.abs(invoice.variance), currency)}
                        </span>
                      </Td>
                      <Td align="right">
                        <DeleteInvoiceButton id={invoice.id} label={invoice.filename} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {checked.length > 1 ? (
              <p className="mt-4 text-xs text-muted">
                Across {checked.length} checked invoices the supplier has billed{" "}
                <strong className={runningVariance > 0.01 ? "text-neg" : "text-body"}>
                  {runningVariance >= 0 ? "+" : "−"}
                  {formatMoney(Math.abs(runningVariance), currency)}
                </strong>{" "}
                against the quote. A rate creeping up shows here before it shows on any one
                day.
              </p>
            ) : null}
          </>
        ) : (
          <Empty>Nothing checked yet. Upload an invoice above.</Empty>
        )}
      </Card>
    </div>
  );
}
