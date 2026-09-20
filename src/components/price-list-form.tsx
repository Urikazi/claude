"use client";

import { useActionState, useState, useTransition } from "react";
import { importBundledPriceList, importPriceList, type ActionState } from "@/lib/actions";
import type { BundledPriceListOption } from "@/lib/bundled-price-lists";
import { Card, buttonClass, ghostButtonClass, inputClass } from "@/components/ui";

export type TierSummary = {
  sku: string;
  countries: number;
  maxQuantity: number;
  sample: { country: string; totals: number[] } | null;
};

export function PriceListForm({
  storeId,
  summary,
  bundled,
}: {
  storeId: string;
  summary: TierSummary[];
  bundled: BundledPriceListOption[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    importPriceList,
    null,
  );
  const [open, setOpen] = useState(false);
  const [bundledPending, startBundled] = useTransition();
  const [bundledState, setBundledState] = useState<ActionState>(null);
  const [chosenKey, setChosenKey] = useState(bundled[0]?.key ?? "");
  // Keyed by SKU rather than held as one number: the main product and the add-on that
  // ships with it are different things and rarely cost the same to make.
  const [unitCosts, setUnitCosts] = useState<Record<string, string>>({});

  const chosen = bundled.find((entry) => entry.key === chosenKey) ?? bundled[0];

  function importChosen() {
    if (!chosen) return;
    const costs: Record<string, number> = {};
    for (const product of chosen.products) {
      const raw = unitCosts[product.sku]?.trim();
      if (raw) costs[product.sku] = Number(raw);
    }
    startBundled(async () =>
      setBundledState(await importBundledPriceList(storeId, chosen.key, costs)),
    );
  }

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

      {(summary.length === 0 || open) && chosen ? (
        <div className="mt-4 rounded-lg border border-accent/40 bg-accent/5 p-3">
          <p className="text-xs text-body">
            {summary.length === 0
              ? "No prices loaded, so every order is costed at zero and profit is overstated. Load a supplier quote that ships with this dashboard, or paste your own below."
              : "Re-importing replaces the list in place — the way to correct a unit cost you estimated."}
          </p>

          {bundled.length > 1 ? (
            <label className="mt-3 block text-xs text-muted">
              Quote
              <select
                value={chosen.key}
                onChange={(event) => setChosenKey(event.target.value)}
                className={`${inputClass} mt-1`}
              >
                {bundled.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label} — {entry.prices} prices across {entry.products.length}{" "}
                    {entry.products.length === 1 ? "product" : "products"} and{" "}
                    {entry.countries} destinations
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {chosen.shippingOnly ? (
            <div className="mt-3 rounded-lg border border-neg/40 bg-neg/5 p-3">
              <p className="text-xs text-body">
                <strong>{chosen.label}&rsquo;s quote covers shipping only.</strong>{" "}
                {chosen.note ??
                  "The supplier priced the parcel, not the product inside it."}{" "}
                Enter what each unit costs to make and it is added on top of every quoted
                total — without it each unit is costed at freight alone and the product&rsquo;s
                whole margin is reported as profit.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {chosen.products.map((product) => (
                  <label key={product.sku} className="text-xs text-muted">
                    <span className="font-mono text-body">{product.sku}</span>
                    {product.name ? ` — ${product.name}` : null}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="Cost per unit"
                      value={unitCosts[product.sku] ?? ""}
                      onChange={(event) =>
                        setUnitCosts((previous) => ({
                          ...previous,
                          [product.sku]: event.target.value,
                        }))
                      }
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={bundledPending}
              className={buttonClass}
              onClick={importChosen}
            >
              {bundledPending ? "Importing…" : `Load the ${chosen.label} price list`}
            </button>
            {summary.length === 0 ? (
              <button type="button" onClick={() => setOpen(true)} className={ghostButtonClass}>
                Paste my own instead
              </button>
            ) : null}
            {bundledState ? (
              <span className={`text-xs ${bundledState.ok ? "text-pos" : "text-neg"}`}>
                {bundledState.message}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

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
