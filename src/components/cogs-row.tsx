"use client";

import { useActionState, useId, useState } from "react";
import {
  TIER_QUANTITIES,
  updateVariantCostTiers,
  updateVariantCosts,
  type ActionState,
} from "@/lib/actions";
import { Td } from "@/components/ui";
import { formatMoney, formatPercent } from "@/lib/format";

const cellInput =
  "w-full max-w-28 rounded-md border border-line bg-panel-2 px-2 py-1.5 text-right text-sm tabular-nums outline-none transition focus:border-accent";

export type VariantRow = {
  id: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  price: number;
  cogs: number;
  shippingCost: number;
  handlingCost: number;
  unitsSold: number;
  /// Costed by the supplier price list, so the per-unit fields are unused.
  pricedFromList?: boolean;
  /// Existing quantity prices for this SKU, keyed by quantity.
  tiers?: Record<number, number>;
};

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
  const tierFormId = useId();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateVariantCosts,
    null,
  );
  const [tierState, tierAction, tierPending] = useActionState<ActionState, FormData>(
    updateVariantCostTiers,
    null,
  );
  const [open, setOpen] = useState(false);

  // Mirrors the inputs so the margin column updates as the operator types.
  const [draft, setDraft] = useState({
    cogs: variant.cogs,
    shippingCost: variant.shippingCost,
    handlingCost: variant.handlingCost,
  });

  const tierCount = Object.keys(variant.tiers ?? {}).length;
  const totalCost = draft.cogs + draft.shippingCost + draft.handlingCost;
  const unitMargin = variant.price - totalCost;
  const marginPercent = variant.price > 0 ? (unitMargin / variant.price) * 100 : 0;

  const numberField = (name: keyof typeof draft, label: string) => (
    <input
      form={formId}
      name={name}
      type="number"
      step="0.01"
      min="0"
      value={draft[name]}
      onChange={(event) =>
        setDraft((current) => ({ ...current, [name]: Number(event.target.value) || 0 }))
      }
      className={cellInput}
      disabled={tierCount > 0}
      aria-label={`${label} for ${variant.productTitle}`}
    />
  );

  return (
    <>
      <tr>
        <Td>
          <span className="block">{variant.productTitle}</span>
          <span className="text-[11px] text-muted">
            {variant.variantTitle !== "Default Title" ? variant.variantTitle : ""}
            {variant.sku ? ` · ${variant.sku}` : ""}
          </span>
          {variant.pricedFromList || tierCount > 0 ? (
            <span
              className="ml-2 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted"
              title="Cost comes from quantity pricing, which prices the whole line at once. The per-unit fields on this row are unused."
            >
              quantity priced
            </span>
          ) : null}
        </Td>
        <Td align="right">{formatMoney(variant.price, currency)}</Td>
        <Td align="right">{variant.unitsSold}</Td>
        <Td align="right">{numberField("cogs", "Cost of goods")}</Td>
        <Td align="right">{numberField("shippingCost", "Shipping cost")}</Td>
        <Td align="right">{numberField("handlingCost", "Handling cost")}</Td>
        <Td align="right">
          {tierCount > 0 ? (
            <span className="text-[11px] text-muted">by quantity</span>
          ) : (
            <>
              <span className={unitMargin >= 0 ? "text-pos" : "text-neg"}>
                {formatMoney(unitMargin, currency)}
              </span>
              <span className="ml-1 text-[11px] text-muted">{formatPercent(marginPercent)}</span>
            </>
          )}
        </Td>
        <Td align="right">
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="rounded-md border border-line px-2 py-1.5 text-xs text-muted transition hover:border-accent hover:text-body"
              aria-expanded={open}
            >
              {tierCount > 0 ? `${tierCount} qty` : "Qty"}
            </button>
            <form action={formAction} id={formId}>
              <input type="hidden" name="variantId" value={variant.id} />
            </form>
            <button
              type="submit"
              form={formId}
              disabled={pending || tierCount > 0}
              title={tierCount > 0 ? "Quantity pricing is in use for this SKU" : undefined}
              className="rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-xs transition hover:border-accent disabled:opacity-50"
            >
              {pending ? "…" : state?.ok ? "Saved" : "Save"}
            </button>
          </div>
        </Td>
      </tr>

      {open ? (
        <tr>
          <td colSpan={8} className="border-b border-line bg-panel-2/40 px-4 py-4">
            {variant.sku ? (
              <form action={tierAction} id={tierFormId} className="space-y-3">
                <input type="hidden" name="storeId" value={storeId} />
                <input type="hidden" name="sku" value={variant.sku} />
                <p className="text-xs text-muted">
                  Cost of a whole order line, not per unit. If 2 pieces cost you 9.99 rather
                  than twice the single price, enter 9.99 against 2 pcs. Leave a box empty if
                  you have no price for that quantity; clear them all to go back to the
                  per-unit fields above.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  {TIER_QUANTITIES.map((quantity) => (
                    <label key={quantity} className="block">
                      <span className="mb-1 block text-[11px] text-muted">
                        {quantity} {quantity === 1 ? "pc" : "pcs"}
                      </span>
                      <input
                        name={`tier_${quantity}`}
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={variant.tiers?.[quantity] ?? ""}
                        placeholder="—"
                        className="w-24 rounded-md border border-line bg-panel px-2 py-1.5 text-right text-sm tabular-nums outline-none transition focus:border-accent"
                        aria-label={`Cost for ${quantity} pieces of ${variant.productTitle}`}
                      />
                    </label>
                  ))}
                  <button
                    type="submit"
                    form={tierFormId}
                    disabled={tierPending}
                    className="rounded-md border border-line bg-panel-2 px-3 py-1.5 text-xs transition hover:border-accent disabled:opacity-50"
                  >
                    {tierPending ? "Saving…" : "Save quantity prices"}
                  </button>
                </div>
                {tierState ? (
                  <p className={`text-xs ${tierState.ok ? "text-pos" : "text-neg"}`}>
                    {tierState.message}
                  </p>
                ) : null}
              </form>
            ) : (
              <p className="text-xs text-neg">
                This variant has no SKU in Shopify, so quantity prices cannot be matched to
                it. Add a SKU to the variant in Shopify and sync again.
              </p>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
