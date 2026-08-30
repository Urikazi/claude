"use client";

import { useActionState, useState } from "react";
import { importPriceList, type ActionState } from "@/lib/actions";
import { Card, buttonClass, inputClass } from "@/components/ui";

export type TierSummary = {
  sku: string;
  countries: number;
  maxQuantity: number;
  sample: { country: string; totals: number[] } | null;
};

export function PriceListForm({
  storeId,
  summary,
}: {
  storeId: string;
  summary: TierSummary[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    importPriceList,
    null,
  );
  const [open, setOpen] = useState(summary.length === 0);

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Supplier price list</h2>
          <p className="mt-1 text-xs text-muted">
            Fulfilment quotes price a whole line at once — two units cost less than twice
            one, because the parcel ships once. When a SKU is listed here, its quoted total
            is used instead of the per-unit costs below.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-muted hover:text-fg"
        >
          {open ? "Hide" : summary.length ? "Replace list" : "Add list"}
        </button>
      </div>

      {summary.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted">
              <tr className="text-left">
                <th className="py-1 pr-4 font-medium">SKU</th>
                <th className="py-1 pr-4 font-medium">Destinations</th>
                <th className="py-1 pr-4 font-medium">Quantities</th>
                <th className="py-1 font-medium">Example</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr key={row.sku} className="border-t border-line">
                  <td className="py-1.5 pr-4 font-mono">{row.sku}</td>
                  <td className="py-1.5 pr-4">
                    {row.countries === 1 && row.sample?.country === "*"
                      ? "all countries"
                      : `${row.countries} countries`}
                  </td>
                  <td className="py-1.5 pr-4">1–{row.maxQuantity}</td>
                  <td className="py-1.5 text-muted">
                    {row.sample
                      ? `${row.sample.country}: ${row.sample.totals
                          .slice(0, 4)
                          .map((t, i) => `${i + 1}u $${t.toFixed(2)}`)
                          .join(" · ")}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {open ? (
        <form action={formAction} className="mt-4 space-y-3">
          <input type="hidden" name="storeId" value={storeId} />
          <textarea
            name="priceList"
            rows={8}
            spellCheck={false}
            placeholder={PLACEHOLDER}
            className={`${inputClass} font-mono text-xs`}
          />
          <p className="text-xs text-muted">
            Each list of numbers is the quoted <strong>total</strong> for 1 unit, 2 units, 3
            units and so on — not a unit price. Use <code>&quot;*&quot;</code> for a price
            that applies everywhere. Importing replaces the previous list and reprices
            existing orders.
          </p>
          <button type="submit" disabled={pending} className={buttonClass}>
            {pending ? "Importing…" : "Import price list"}
          </button>
          {state ? (
            <p className={`text-xs ${state.ok ? "text-pos" : "text-neg"}`}>{state.message}</p>
          ) : null}
        </form>
      ) : null}
    </Card>
  );
}

const PLACEHOLDER = `{
  "products": [
    { "sku": "FL2600896", "name": "Foundation Stick",
      "tiers": { "US": [6.59, 9.99, 11.99], "GB": [5.99, 8.59, 11.19] } },
    { "sku": "AL2500749", "name": "Brush", "tiers": { "*": [1.0] } }
  ]
}`;
