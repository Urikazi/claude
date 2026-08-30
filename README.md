# PNL Dashboard

Profit-and-loss tracking for Shopify stores. Pulls revenue from Shopify, ad spend from Meta Ads,
and real transaction fees from Stripe and PayPal, subtracts the COGS you enter per product, and
reports what actually landed in your pocket.

## What it tracks

| Input | Source |
| --- | --- |
| Daily revenue, orders, refunds | Shopify Admin GraphQL API (custom app) |
| Ad spend, impressions, clicks | Meta Marketing API (campaign-level, daily) |
| Payment processing fees | Stripe balance transactions, PayPal transaction search |
| Shopify transaction fee | Configurable, defaults to 0.6% |
| COGS, shipping, handling | Entered per variant in the dashboard |

The profit calculation:

```
net revenue      = order total − refunds
gross profit     = net revenue − COGS − shipping − handling − processing fees − Shopify fees
net profit       = gross profit − ad spend
```

Fees start as estimates from your configured rates, then get replaced with the **real** amounts
Stripe and PayPal charged once you run a fee sync. The Shopify 0.6% fee is applied to every order
that was not paid through Shopify Payments.

## Getting started

```bash
npm install
cp .env.example .env
npx prisma migrate dev     # create the database
npm run db:seed            # optional: 90 days of demo data
npm run dev
```

Open http://localhost:3000 — you land on the dashboard.

The demo seed gives you a fully populated dashboard so you can see the shape of the thing before
connecting anything. Delete the "Demo Store" row (or your whole `prisma/dev.db`) once you connect
real credentials.

## Connecting your accounts

Everything is configured per-store at **/dashboard/settings**. Credentials are stored in your own
database and are never sent anywhere except the provider they belong to.

**Shopify** — In your Shopify admin go to Settings → Apps and sales channels → Develop apps →
Create an app. Grant the Admin API scopes `read_orders`, `read_all_orders` and `read_products`,
install the app, then copy the Admin API access token (`shpat_…`) and your `*.myshopify.com`
domain into the settings page.

**Meta Ads** — Create a Meta app, add the Marketing API product, and generate a long-lived access
token holding the `ads_read` permission. Your ad account ID is the `act_…` value shown in Ads
Manager.

**Stripe** — A restricted key with read access to Charges and Balance Transactions is enough.

**PayPal** — Create a REST app in the PayPal developer dashboard and enable "Transaction Search"
on it. Uncheck live mode in settings to use sandbox credentials.

Once saved, hit **Sync all**, or sync individual sources from the settings page.

## Entering COGS

Go to **Products & COGS**. Each variant takes three numbers:

- **COGS** — what the unit costs you
- **Shipping** — per-unit fulfilment cost
- **Handling** — per-unit packaging/pick-pack cost

Variants without a cost are sorted to the top of the list, and the overview page warns you while
any remain — profit is overstated until they are filled in.

Costs are snapshotted onto each order line at sync time, so editing a cost today does not silently
rewrite last quarter's reported profit. Saving a cost does push it onto that variant's existing
line items; use **Re-apply costs to past orders** in settings to force a full refresh.

If you maintain unit costs in Shopify's own inventory screen, the product sync imports them
automatically as a starting point and will not overwrite anything you have typed here.

## Automating the sync

Point any scheduler at the sync endpoint:

```bash
curl -X POST https://your-app/api/sync
curl -X POST "https://your-app/api/sync?source=meta&days=7"
```

Sources are `shopify-products`, `shopify-orders`, `meta` and `fees`; omit `source` to run all four.
Set `SYNC_SECRET` in the environment and pass it as `Authorization: Bearer <token>` to lock the
endpoint down. The route also accepts GET so schedulers that only issue GETs (Vercel Cron) work.

A daily run shortly after midnight in your store's timezone is usually enough. Meta restates spend
for a day or two after the fact, so a look-back of at least 7 days is worth keeping.

## Multi-channel ad spend

Only Meta syncs automatically. Spend from TikTok, Google or anywhere else can be entered by day on
the **Ad spend** page and is included in net profit exactly like synced spend.

## Notes

- SQLite is the default so the app runs with no external services. For production, change the
  `datasource` provider in `prisma/schema.prisma` to `postgresql` and re-run the migration.
- There is no authentication. Put it behind your own auth layer, a VPN, or platform access
  controls before exposing it — the settings page holds live API credentials.
- Order-level profit on the Orders page excludes ad spend, which is only meaningful at the account
  level. Net profit including ads is on the overview.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run db:migrate` | Create/apply a migration |
| `npm run db:seed` | Load demo data |
| `npm run db:studio` | Browse the database |
