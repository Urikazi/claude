"use client";

import { useActionState, useId, useState } from "react";
import { updateVariantCosts, type ActionState } from "@/lib/actions";
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
  /// Costed by the supplier price list, so the per-unit fields below are unused.
  pricedFromList?: boolean;
};

export function CogsRow({ variant, currency }: { variant: VariantRow; currency: string }) {
  const formId = useId();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateVariantCosts,
    null,
  );

  // Mirrors the inputs so the margin column updates as the operator types.
  const [draft, setDraft] = useState({
    cogs: variant.cogs,
    shippingCost: variant.shippingCost,
    handlingCost: variant.handlingCost,
  });

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
      aria-label={`${label} for ${variant.productTitle}`}
    />
  );

  return (
    <tr>
      <Td>
        <span className="block">{variant.productTitle}</span>
        <span className="text-[11px] text-muted">
          {variant.variantTitle !== "Default Title" ? variant.variantTitle : ""}
          {variant.sku ? ` · ${variant.sku}` : ""}
        </span>
        {variant.pricedFromList ? (
          <span
            className="ml-2 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted"
            title="Cost comes from the supplier price list, which prices the whole line at once. The fields on this row are ignored."
          >
            priced from list
          </span>
        ) : null}
      </Td>
      <Td align="right">{formatMoney(variant.price, currency)}</Td>
      <Td align="right">{variant.unitsSold}</Td>
      <Td align="right">{numberField("cogs", "Cost of goods")}</Td>
      <Td align="right">{numberField("shippingCost", "Shipping cost")}</Td>
      <Td align="right">{numberField("handlingCost", "Handling cost")}</Td>
      <Td align="right">
        <span className={unitMargin >= 0 ? "text-pos" : "text-neg"}>
          {formatMoney(unitMargin, currency)}
        </span>
        <span className="ml-1 text-[11px] text-muted">{formatPercent(marginPercent)}</span>
      </Td>
      <Td align="right">
        <form action={formAction} id={formId}>
          <input type="hidden" name="variantId" value={variant.id} />
        </form>
        <button
          type="submit"
          form={formId}
          disabled={pending}
          className="rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-xs transition hover:border-accent disabled:opacity-50"
        >
          {pending ? "…" : state?.ok ? "Saved" : "Save"}
        </button>
      </Td>
    </tr>
  );
}
