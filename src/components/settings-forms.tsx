"use client";

import { useActionState, useState, useTransition } from "react";
import {
  resnapshotCosts,
  runSync,
  updateFeeConfig,
  updateStoreSettings,
  type ActionState,
} from "@/lib/actions";
import { Card, Field, buttonClass, ghostButtonClass, inputClass } from "@/components/ui";

function Status({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p className={`text-xs ${state.ok ? "text-pos" : "text-neg"}`}>{state.message}</p>
  );
}

export type StoreSettings = {
  id: string;
  name: string;
  currency: string;
  shopifyDomain: string | null;
  metaAdAccountId: string | null;
  paypalClientId: string | null;
  paypalLiveMode: boolean;
  hasShopifyToken: boolean;
  hasMetaToken: boolean;
  hasStripeKey: boolean;
  hasPaypalSecret: boolean;
};

export function ConnectionsForm({ store }: { store: StoreSettings }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateStoreSettings,
    null,
  );

  const secretPlaceholder = (present: boolean) =>
    present ? "•••••••• (leave blank to keep)" : "Not set";

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="storeId" value={store.id} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Store name">
          <input name="name" defaultValue={store.name} required className={inputClass} />
        </Field>
        <Field label="Currency" hint="Three-letter ISO code used for all reporting.">
          <input
            name="currency"
            defaultValue={store.currency}
            maxLength={3}
            required
            className={inputClass}
          />
        </Field>
      </div>

      <div className="space-y-3 border-t border-line pt-5">
        <h3 className="text-sm font-semibold">Shopify</h3>
        <p className="text-xs text-muted">
          Shopify admin → Settings → Apps and sales channels → Develop apps → create an app with
          the <code>read_orders</code>, <code>read_all_orders</code> and <code>read_products</code>{" "}
          Admin API scopes, then install it and copy the access token.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Store domain">
            <input
              name="shopifyDomain"
              defaultValue={store.shopifyDomain ?? ""}
              placeholder="my-store.myshopify.com"
              className={inputClass}
            />
          </Field>
          <Field label="Admin API access token">
            <input
              name="shopifyAccessToken"
              type="password"
              placeholder={secretPlaceholder(store.hasShopifyToken)}
              className={inputClass}
            />
          </Field>
        </div>
      </div>

      <div className="space-y-3 border-t border-line pt-5">
        <h3 className="text-sm font-semibold">Meta Ads</h3>
        <p className="text-xs text-muted">
          Create a Meta app with the Marketing API product and generate a long-lived token holding
          the <code>ads_read</code> permission.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ad account ID">
            <input
              name="metaAdAccountId"
              defaultValue={store.metaAdAccountId ?? ""}
              placeholder="act_1234567890"
              className={inputClass}
            />
          </Field>
          <Field label="Access token">
            <input
              name="metaAccessToken"
              type="password"
              placeholder={secretPlaceholder(store.hasMetaToken)}
              className={inputClass}
            />
          </Field>
        </div>
      </div>

      <div className="space-y-3 border-t border-line pt-5">
        <h3 className="text-sm font-semibold">Stripe</h3>
        <p className="text-xs text-muted">
          A restricted key with read access to charges and balance transactions is enough. Real
          fees replace the estimates once a fee sync runs.
        </p>
        <Field label="Secret key">
          <input
            name="stripeSecretKey"
            type="password"
            placeholder={secretPlaceholder(store.hasStripeKey)}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="space-y-3 border-t border-line pt-5">
        <h3 className="text-sm font-semibold">PayPal</h3>
        <p className="text-xs text-muted">
          Create a REST app in the PayPal developer dashboard and enable the Transaction Search
          feature on it.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client ID">
            <input
              name="paypalClientId"
              defaultValue={store.paypalClientId ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Client secret">
            <input
              name="paypalClientSecret"
              type="password"
              placeholder={secretPlaceholder(store.hasPaypalSecret)}
              className={inputClass}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="paypalLiveMode"
            defaultChecked={store.paypalLiveMode}
            className="h-4 w-4 rounded border-line"
          />
          Live mode (uncheck for sandbox)
        </label>
      </div>

      <div className="flex items-center gap-3 border-t border-line pt-5">
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? "Saving…" : "Save connections"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export type FeeSettings = {
  shopifyTransactionRate: number;
  stripePercent: number;
  stripeFixed: number;
  paypalPercent: number;
  paypalFixed: number;
  defaultPercent: number;
  defaultFixed: number;
};

export function FeeForm({ storeId, fees }: { storeId: string; fees: FeeSettings }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateFeeConfig,
    null,
  );

  const percent = (value: number) => (value * 100).toFixed(3).replace(/\.?0+$/, "");

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="storeId" value={storeId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Shopify transaction fee (%)"
          hint="Charged on orders not paid through Shopify Payments. Default 0.6%."
        >
          <input
            name="shopifyTransactionRate"
            type="number"
            step="0.001"
            min="0"
            defaultValue={percent(fees.shopifyTransactionRate)}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Stripe rate (%)">
          <input
            name="stripePercent"
            type="number"
            step="0.01"
            min="0"
            defaultValue={percent(fees.stripePercent)}
            className={inputClass}
          />
        </Field>
        <Field label="Stripe fixed fee per transaction">
          <input
            name="stripeFixed"
            type="number"
            step="0.01"
            min="0"
            defaultValue={fees.stripeFixed}
            className={inputClass}
          />
        </Field>
        <Field label="PayPal rate (%)">
          <input
            name="paypalPercent"
            type="number"
            step="0.01"
            min="0"
            defaultValue={percent(fees.paypalPercent)}
            className={inputClass}
          />
        </Field>
        <Field label="PayPal fixed fee per transaction">
          <input
            name="paypalFixed"
            type="number"
            step="0.01"
            min="0"
            defaultValue={fees.paypalFixed}
            className={inputClass}
          />
        </Field>
        <Field label="Other gateways rate (%)">
          <input
            name="defaultPercent"
            type="number"
            step="0.01"
            min="0"
            defaultValue={percent(fees.defaultPercent)}
            className={inputClass}
          />
        </Field>
        <Field label="Other gateways fixed fee">
          <input
            name="defaultFixed"
            type="number"
            step="0.01"
            min="0"
            defaultValue={fees.defaultFixed}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? "Saving…" : "Save fees & recalculate"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

const SYNC_TARGETS = [
  { key: "shopify-products", label: "Shopify products" },
  { key: "shopify-orders", label: "Shopify orders" },
  { key: "meta", label: "Meta Ads spend" },
  { key: "fees", label: "Stripe & PayPal fees" },
] as const;

export function SyncPanel({ storeId }: { storeId: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  const [days, setDays] = useState(60);

  const trigger = (action: () => Promise<ActionState>) =>
    startTransition(async () => setState(await action()));

  return (
    <Card title="Manual sync">
      <div className="mb-4 max-w-40">
        <Field label="Look back (days)">
          <input
            type="number"
            min="1"
            max="365"
            value={days}
            onChange={(event) => setDays(Number(event.target.value) || 60)}
            className={inputClass}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        {SYNC_TARGETS.map((target) => (
          <button
            key={target.key}
            type="button"
            disabled={pending}
            className={ghostButtonClass}
            onClick={() => trigger(() => runSync(storeId, target.key, days))}
          >
            {target.label}
          </button>
        ))}
        <button
          type="button"
          disabled={pending}
          className={ghostButtonClass}
          onClick={() => trigger(() => resnapshotCosts(storeId))}
        >
          Re-apply costs to past orders
        </button>
      </div>
      {pending && <p className="mt-3 text-xs text-muted">Running…</p>}
      {!pending && state && (
        <p className={`mt-3 whitespace-pre-wrap text-xs ${state.ok ? "text-pos" : "text-neg"}`}>
          {state.message}
        </p>
      )}
    </Card>
  );
}
