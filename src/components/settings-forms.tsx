"use client";

import { useActionState, useState, useTransition } from "react";
import {
  resnapshotCosts,
  runSync,
  updateAdvisorApiKey,
  updateAdvisorModel,
  updateFeeConfig,
  updateStoreSettings,
  testMetaAdAccount,
  type ActionState,
} from "@/lib/actions";
import { Card, Field, buttonClass, ghostButtonClass, inputClass } from "@/components/ui";

/**
 * Named zones rather than fixed offsets, so a store that observes daylight saving
 * does not drift by an hour for half the year.
 */
const TIME_ZONES = [
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "GMT/BST — London, Lisbon" },
  { value: "Europe/Paris", label: "GMT+1 — Paris, Madrid, Berlin, Rome" },
  { value: "Europe/Athens", label: "GMT+2 — Athens, Helsinki" },
  { value: "Etc/GMT-1", label: "GMT+1 fixed (no daylight saving)" },
  { value: "America/New_York", label: "US Eastern" },
  { value: "America/Chicago", label: "US Central" },
  { value: "America/Denver", label: "US Mountain" },
  { value: "America/Los_Angeles", label: "US Pacific" },
  { value: "America/Sao_Paulo", label: "Brazil — Sao Paulo" },
  { value: "Asia/Dubai", label: "GMT+4 — Dubai" },
  { value: "Asia/Singapore", label: "GMT+8 — Singapore" },
  { value: "Australia/Sydney", label: "Australia — Sydney" },
];

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
  timezone: string;
  shopifyDomain: string | null;
  shopifyClientId: string | null;
  metaAccounts: MetaAccountRow[];
  metaReportsNewCustomersOnly: boolean;
  paypalClientId: string | null;
  paypalLiveMode: boolean;
  hasShopifyToken: boolean;
  hasShopifyClientSecret: boolean;
  hasStripeKey: boolean;
  hasPaypalSecret: boolean;
};

export type MetaAccountRow = {
  /** Blank on a row the user has just added and not yet saved. */
  id: string;
  accountId: string;
  label: string;
  active: boolean;
  /** Whether a token is already stored, so the field can say "leave blank to keep". */
  hasToken: boolean;
};

/**
 * Asks Meta about one saved account and shows the answer.
 *
 * Only offered for a row that is already stored: there is nothing to test until a
 * token has been saved, and testing what is typed into the box would need the key to
 * travel somewhere it does not need to go.
 */
function TestAccountButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        className={ghostButtonClass}
        onClick={() => start(async () => setResult(await testMetaAdAccount(id)))}
      >
        {pending ? "Asking Meta…" : "Test"}
      </button>
      {result ? (
        <p className={`basis-full text-xs ${result.ok ? "text-pos" : "text-neg"}`}>
          {result.message}
        </p>
      ) : null}
    </>
  );
}

/** A client-side key for rows that have no database id yet. */
let nextDraftKey = 0;

/**
 * The store's Meta ad accounts, as a list that can be added to and removed from.
 *
 * Rows are submitted with the rest of the settings form under indexed names, so the
 * whole list saves in one go. Removing a row simply drops it from the submission —
 * there is no separate delete, and so no way for a half-finished edit to be saved
 * against an account that is on its way out.
 */
function MetaAccountsField({ initial }: { initial: MetaAccountRow[] }) {
  const [rows, setRows] = useState<(MetaAccountRow & { key: string })[]>(() =>
    initial.map((row, index) => ({ ...row, key: row.id || `draft-${index}` })),
  );

  const add = () => {
    nextDraftKey += 1;
    setRows((current) => [
      ...current,
      {
        key: `draft-new-${nextDraftKey}`,
        id: "",
        accountId: "",
        label: "",
        active: true,
        hasToken: false,
      },
    ]);
  };

  const remove = (key: string) => setRows((current) => current.filter((row) => row.key !== key));

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-xs text-muted">No ad accounts connected yet.</p>
      ) : null}

      {rows.map((row, index) => (
        <div key={row.key} className="rounded-lg border border-line p-3 space-y-3">
          <input type="hidden" name={`metaAccount.${index}.id`} value={row.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ad account ID">
              <input
                name={`metaAccount.${index}.accountId`}
                defaultValue={row.accountId}
                placeholder="act_1234567890"
                className={inputClass}
              />
            </Field>
            <Field label="Name (optional)">
              <input
                name={`metaAccount.${index}.label`}
                defaultValue={row.label}
                placeholder="US prime"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Access token">
            <input
              name={`metaAccount.${index}.token`}
              type="password"
              placeholder={
                row.hasToken ? "•••••••• (leave blank to keep)" : "Long-lived token with ads_read"
              }
              className={inputClass}
            />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={`metaAccount.${index}.active`}
                defaultChecked={row.active}
                className="h-4 w-4 rounded border-line"
              />
              <span>
                Sync this account
                <span className="ml-2 text-xs text-muted">
                  Untick to keep the credentials but skip it.
                </span>
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {row.id ? <TestAccountButton id={row.id} /> : null}
              <button
                type="button"
                onClick={() => remove(row.key)}
                className={ghostButtonClass}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ))}

      <button type="button" onClick={add} className={ghostButtonClass}>
        + Add ad account
      </button>
    </div>
  );
}

/**
 * The Claude API key behind both advisors.
 *
 * Its own form rather than a field on the connections one: it is set once for the whole
 * dashboard rather than per store, and saving it alongside a store's credentials would
 * imply otherwise.
 */
export function AdvisorKeyForm({ source }: { source: "environment" | "stored" | "missing" }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateAdvisorApiKey,
    null,
  );
  const [removing, setRemoving] = useState(false);

  if (source === "environment") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-pos">Set from the environment.</p>
        <p className="text-xs text-muted">
          <code>ANTHROPIC_API_KEY</code> is set on the host, which is the safer place for it —
          the key never reaches your database. A key pasted here would be ignored while that
          variable is set, so this form stays out of your way.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <p className="text-xs text-muted">
        Powers both advisors. One key for the whole dashboard, not per store. Create one at{" "}
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline"
        >
          console.anthropic.com
        </a>{" "}
        — it starts <code>sk-ant-</code>, and the account needs credit. This is billed
        separately from a Claude subscription.
      </p>
      <Field label="Claude API key">
        <input
          name="anthropicApiKey"
          type="password"
          autoComplete="off"
          placeholder={source === "stored" ? "•••••••• (leave blank to keep)" : "sk-ant-..."}
          disabled={removing}
          className={inputClass}
        />
      </Field>
      <p className="text-xs text-muted">
        Stored in your database in plain text, like the Shopify and Meta credentials above, so
        your <code>DATABASE_URL</code> is as sensitive as this key — and this one can spend
        money. Setting <code>ANTHROPIC_API_KEY</code> on your host instead avoids that, and
        takes precedence over anything saved here.
      </p>
      {source === "stored" ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="remove"
            checked={removing}
            onChange={(event) => setRemoving(event.target.checked)}
            className="h-4 w-4 rounded border-line"
          />
          <span>Remove the stored key</span>
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : removing ? "Remove key" : "Save key"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export type AdvisorModelOption = {
  id: string;
  label: string;
  note: string;
  perTurn: string;
  pricing: string;
};

/** Which model the advisors run on. One choice for the whole dashboard. */
export function AdvisorModelForm({
  models,
  current,
}: {
  models: AdvisorModelOption[];
  current: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateAdvisorModel,
    null,
  );
  const [chosen, setChosen] = useState(current);
  const selected = models.find((model) => model.id === chosen) ?? models[0];

  return (
    <form action={formAction} className="space-y-3 border-t border-line pt-5">
      <h3 className="text-sm font-semibold">Model</h3>
      <Field label="Claude model">
        <select
          name="model"
          value={chosen}
          onChange={(event) => setChosen(event.target.value)}
          className={inputClass}
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} — {model.pricing}, about {model.perTurn} a question
            </option>
          ))}
        </select>
      </Field>
      <p className="text-xs text-muted">{selected.note}</p>
      <p className="text-xs text-muted">
        The per-question figure is a guide, not a quote: a turn carries the brief, a live
        snapshot of the store and the conversation so far, so it grows as a thread runs.
        Set a hard ceiling under Billing → Limits in the Anthropic console rather than
        relying on an estimate.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || chosen === current} className={buttonClass}>
          {pending ? "Saving…" : "Save model"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

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
        <Field
          label="Time zone"
          hint="Taken from Shopify on every order sync, so a day here is the same day there. Anything set here is replaced the next time orders sync."
        >
          <select name="timezone" defaultValue={store.timezone} className={inputClass}>
            {TIME_ZONES.map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="space-y-3 border-t border-line pt-5">
        <h3 className="text-sm font-semibold">Shopify</h3>
        <p className="text-xs text-muted">
          In the Shopify Dev Dashboard, open your app → App settings → Credentials, and copy the
          Client ID and a Secret. The app must live in the same organization as the store, and
          access tokens are minted automatically and refreshed every 24 hours.
        </p>
        <p className="text-xs text-muted">
          Scopes: <code>read_orders</code> and <code>read_products</code> for revenue,{" "}
          <code>read_all_orders</code> for history older than 60 days,{" "}
          <code>read_customers</code> to tell a first purchase from a repeat, and{" "}
          <code>read_reports</code> for the sessions that conversion rate divides by. Adding a
          scope is not enough on its own — release a new version <em>and</em> reinstall the app on
          the store, or it keeps the permissions it was installed with.
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
          <Field label="Client ID">
            <input
              name="shopifyClientId"
              defaultValue={store.shopifyClientId ?? ""}
              placeholder="32-character client ID"
              className={inputClass}
            />
          </Field>
          <Field label="Client secret">
            <input
              name="shopifyClientSecret"
              type="password"
              placeholder={secretPlaceholder(store.hasShopifyClientSecret)}
              className={inputClass}
            />
          </Field>
          <Field label="Admin API access token (legacy apps only)">
            <input
              name="shopifyAccessToken"
              type="password"
              placeholder={secretPlaceholder(store.hasShopifyToken)}
              className={inputClass}
            />
          </Field>
        </div>
        <p className="text-xs text-muted">
          Leave the access token blank unless you have an older admin-created custom app with a
          permanent <code>shpat_</code> token. If set, it takes precedence over the client
          credentials above.
        </p>
      </div>

      <div className="space-y-3 border-t border-line pt-5">
        <h3 className="text-sm font-semibold">Meta Ads</h3>
        <p className="text-xs text-muted">
          Create a Meta app with the Marketing API product and generate a long-lived token holding
          the <code>ads_read</code> permission. Add an account per ad account you spend from — all
          of their spend lands on this store&rsquo;s P&amp;L, and each is fetched with its own
          token, so one that stops working does not take the others down with it. If one
          account&rsquo;s spend is missing, <strong>Test</strong> asks Meta about that account on
          its own and reports exactly what it says.
        </p>
        <MetaAccountsField initial={store.metaAccounts} />
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="metaReportsNewCustomersOnly"
            defaultChecked={store.metaReportsNewCustomersOnly}
            className="mt-0.5 h-4 w-4 rounded border-line"
          />
          <span>
            Ads Manager reports new customers only
            <span className="mt-0.5 block text-xs text-muted">
              On when the conversions your ads optimise for already exclude repeat buyers, as a
              tracker configured for new customer purchases does. nc-ROAS and cost per new
              customer then show what Ads Manager shows. Untick it if your ads optimise for
              every purchase, and both revert to figures worked out from Shopify orders.
            </span>
          </span>
        </label>
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

      {/* A normal sync only fetches what Shopify has touched since the last one, which is
          what keeps a daily refresh quick. After granting a scope, that skips every order
          already stored — they have not changed, so the new field never arrives. */}
      <div className="mt-4 border-t border-line pt-4">
        <button
          type="button"
          disabled={pending}
          className={ghostButtonClass}
          onClick={() => trigger(() => runSync(storeId, "shopify-orders", days, true))}
        >
          Re-import every order in the window
        </button>
        <p className="mt-2 max-w-xl text-xs text-muted">
          Fetches the last {days} days again from scratch rather than only what changed. Use it
          after granting a new scope — <code>read_customers</code>, say — so orders already
          stored pick up the new field. Slower, and worth setting the look-back above to cover
          the history you want first.
        </p>
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
