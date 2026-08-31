"use client";

import { useId, useState } from "react";
import { useActionState } from "react";
import { updateVariantCosting, type ActionState } from "@/lib/actions";
import { Td } from "@/components/ui";
import { formatMoney, formatPercent } from "@/lib/format";

const cellInput =
  "w-28 rounded-md border border-line bg-panel-2 px-2 py-1.5 text-right text-sm tabular-nums outline-none transition focus:border-accent";

export type VariantRow = {
  id: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  price: number;
  unitsSold: number;
  /** Cost of a single unit, from the quantity-1 tier. */
  costPerUnit: number;
  /** Totals for larger quantities: 2 units cost this much in all, not each. */
  bundles: { quantity: number; totalCost: number }[];
  /** Set when costs come from a shorter, shared SKU rather than this exact one. */
  inheritedTierSku?: string;
  /** Set when an imported list prices this SKU per destination, which wins here. */
  countryPricedSku?: string;
};

type BundleDraft = { key: string; quantity: string; totalCost: string };

export function CogsRow({
  variant,
  currency,
  storeId,
}: {
  variant: VariantRow;
  currency: string;
  storeId: string;
}) {
  const formId = useId();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateVariantCosting,
    null,
  );
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState(variant.costPerUnit ? String(variant.costPerUnit) : "");
  const [bundles, setBundles] = useState<BundleDraft[]>(
    variant.bundles.map((bundle, index) => ({
      key: `existing-${index}`,
      quantity: String(bundle.quantity),
      totalCost: String(bundle.totalCost),
    })),
  );

  const unitCost = Number(unit) || 0;
  const margin = variant.price > 0 ? ((variant.price - unitCost) / variant.price) * 100 : 0;

  function addBundle() {
    // Suggest the next quantity up, which is nearly always what is wanted.
    const highest = bundles.reduce((max, b) => Math.max(max, Number(b.quantity) || 1), 1);
    setBundles((current) => [
      ...current,
      { key: `new-${Date.now()}`, quantity: String(highest + 1), totalCost: "" },
    ]);
  }

  return (
    <>
      <tr className="align-top">
        <Td>
          <span className="block">{variant.productTitle}</span>
          <span className="text-[11px] text-muted">
            {variant.variantTitle !== "Default Title" ? variant.variantTitle : ""}
            {variant.sku ? ` · ${variant.sku}` : ""}
          </span>
          {variant.inheritedTierSku ? (
            <span
              className="ml-2 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted"
              title={`Costed under ${variant.inheritedTierSku}, which covers every variant of this product.`}
            >
              costed as {variant.inheritedTierSku}
            </span>
          ) : null}
        </Td>
        <Td align="right">{formatMoney(variant.price, currency)}</Td>
        <Td align="right">{variant.unitsSold}</Td>

        <Td align="right">
          <input
            form={formId}
            name="costPerUnit"
            type="number"
            step="0.01"
            min="0"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            placeholder="0.00"
            className={cellInput}
            aria-label={`Cost per unit for ${variant.productTitle}`}
          />
        </Td>

        <Td>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="rounded-md border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-accent hover:text-body"
          >
            {bundles.length} bundle{bundles.length === 1 ? "" : "s"}
          </button>
        </Td>

        <Td align="right">
          {unitCost > 0 ? (
            <>
              <span className={variant.price - unitCost >= 0 ? "text-pos" : "text-neg"}>
                {formatMoney(variant.price - unitCost, currency)}
              </span>
              <span className="ml-1 text-[11px] text-muted">{formatPercent(margin)}</span>
            </>
          ) : (
            <span className="text-[11px] text-muted">—</span>
          )}
        </Td>

        <Td align="right">
          <form action={formAction} id={formId} className="inline">
            <input type="hidden" name="storeId" value={storeId} />
            <input type="hidden" name="sku" value={variant.sku ?? ""} />
          </form>
          <button
            type="submit"
            form={formId}
            disabled={pending || !variant.sku}
            title={variant.sku ? undefined : "This variant has no SKU in Shopify"}
            className="rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-xs transition hover:border-accent disabled:opacity-50"
          >
            {pending ? "…" : state?.ok ? "Saved" : "Save"}
          </button>
        </Td>
      </tr>

      {open ? (
        <tr>
          <td colSpan={7} className="border-b border-line bg-panel-2/40 px-4 py-4">
            <div className="max-w-xl space-y-3">
              <div>
                <p className="text-xs font-medium">Bundle costs</p>
                <p className="mt-1 text-xs text-muted">
                  What that many units cost you <strong>in total</strong>, not each. If 2 cost
                  9.99 rather than twice a single, enter 2 and 9.99. Quantities you do not
                  list are worked out from the ones you do.
                </p>
              </div>

              <div className="space-y-2">
                {bundles.map((bundle, index) => (
                  <div key={bundle.key} className="flex items-center gap-2">
                    <input
                      form={formId}
                      name="bundleQuantity"
                      type="number"
                      min="2"
                      step="1"
                      value={bundle.quantity}
                      onChange={(event) =>
                        setBundles((current) =>
                          current.map((b, i) =>
                            i === index ? { ...b, quantity: event.target.value } : b,
                          ),
                        )
                      }
                      className="w-20 rounded-md border border-line bg-panel px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-accent"
                      aria-label="Bundle quantity"
                    />
                    <span className="text-xs text-muted">units cost</span>
                    <input
                      form={formId}
                      name="bundleCost"
                      type="number"
                      min="0"
                      step="0.01"
                      value={bundle.totalCost}
                      onChange={(event) =>
                        setBundles((current) =>
                          current.map((b, i) =>
                            i === index ? { ...b, totalCost: event.target.value } : b,
                          ),
                        )
                      }
                      placeholder="0.00"
                      className="w-28 rounded-md border border-line bg-panel px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-accent"
                      aria-label="Total cost for the bundle"
                    />
                    <span className="w-24 text-right text-[11px] text-muted">
                      {Number(bundle.totalCost) > 0 && Number(bundle.quantity) > 0
                        ? `${formatMoney(Number(bundle.totalCost) / Number(bundle.quantity), currency)}/unit`
                        : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setBundles((current) => current.filter((_, i) => i !== index))
                      }
                      aria-label={`Remove the ${bundle.quantity}-unit bundle`}
                      className="rounded-md border border-line px-2 py-1.5 text-xs text-neg transition hover:border-neg"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={addBundle}
                  className="rounded-md border border-line px-2.5 py-1.5 text-xs transition hover:border-accent"
                >
                  + Add bundle
                </button>
                <button
                  type="submit"
                  form={formId}
                  disabled={pending || !variant.sku}
                  className="rounded-md border border-line bg-panel-2 px-3 py-1.5 text-xs transition hover:border-accent disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Save costs"}
                </button>
                {state ? (
                  <span className={`text-xs ${state.ok ? "text-pos" : "text-neg"}`}>
                    {state.message}
                  </span>
                ) : null}
              </div>

              {variant.countryPricedSku ? (
                <p className="text-xs text-muted">
                  An imported price list also covers{" "}
                  <code>{variant.countryPricedSku}</code> per destination. Those prices win
                  for the countries they name; what you enter here applies everywhere else.
                </p>
              ) : null}
              {!variant.sku ? (
                <p className="text-xs text-neg">
                  This variant has no SKU in Shopify, so costs cannot be matched to its
                  orders. Add one in Shopify and sync again.
                </p>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
