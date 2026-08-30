# PNL Dashboard

Profit-and-loss tracking for Shopify stores. Pulls revenue from Shopify, ad spend from Meta Ads,
and real transaction fees from Stripe and PayPal, subtracts the COGS you enter per product, and
reports what actually landed in your pocket.

## What it tracks

| Input | Source |
| --- | --- |
| Daily revenue, orders, refunds | Shopify Admin GraphQL API (Dev Dashboard app) |
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

Requires Node.js 20+ and a Postgres database (Neon, Supabase, Railway, or a local server).

```bash
npm install
cp .env.example .env        # set DATABASE_URL
npx prisma migrate deploy   # create the tables
npm run db:seed             # optional: 90 days of demo data
npm run dev
```

Open http://localhost:3000. On first visit you choose a password; after that you sign in with it.

The demo seed gives you a fully populated dashboard so you can see the shape of the thing before
connecting anything. Delete the "Demo Store" row once you connect real credentials.

## Deploying

The dashboard holds live API credentials, so it is locked behind a password and fails closed:
until one is set, every route redirects to `/setup`, and nothing is readable.

1. Push this repo to GitHub and import it at [vercel.com/new](https://vercel.com/new).
2. Add a Postgres database and set `DATABASE_URL` (Vercel's Neon integration sets it for you).
3. Deploy. `vercel-build` runs `prisma migrate deploy` first, so the schema is created for you.
4. Open the deployed URL and set your password. **Do this immediately** — until you do, anyone
   who reaches the URL can claim it. Once set, `/setup` refuses to run again.

`DATABASE_URL` is the only variable you must set by hand. The password hash and session key are
generated on first run and stored in the database.

Prefer managing secrets as environment variables? Set `DASHBOARD_PASSWORD_HASH` and
`SESSION_SECRET` (generate both with `npm run auth:hash -- 'your password'`) and they take
precedence over the database, skipping the setup page entirely.

To sync automatically every morning, set `SYNC_SECRET` and add `vercel.json`:

```json
{ "crons": [{ "path": "/api/sync?source=all", "schedule": "0 6 * * *" }] }
```

with the cron sending `Authorization: Bearer $SYNC_SECRET`. Without that secret or a signed-in
session, `/api/sync` returns 401.

## Connecting your accounts

Everything is configured per-store at **/dashboard/settings**. Credentials are stored in your own
database and are never sent anywhere except the provider they belong to.

**Shopify** — Shopify has retired admin-created custom apps, so this uses the client credentials
grant instead. In the [Dev Dashboard](https://dev.shopify.com), create an app with the
`read_orders` and `read_products` scopes, release a version, and **install it on your store** —
the grant only works against a store the app is installed on. Then open App settings →
Credentials and copy the Client ID and a Secret into the settings page along with your
`*.myshopify.com` domain. Access tokens are minted automatically and refreshed every 24 hours.

Add `read_all_orders` only if you need order history older than 60 days; it requires separate
approval from Shopify. Without it the API returns the last 60 days, which matches the default
sync window.

Legacy apps with a permanent `shpat_` token still work — paste it into the optional access token
field and leave the client credentials blank.

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

- Access is a single shared password, appropriate for one owner. There are no user accounts or
  roles; everyone who signs in sees and can change everything.
- Rotating `SESSION_SECRET`, or clearing the `auth.session_secret` row, invalidates every existing
  session — that is how you sign out a lost device.
- Provider credentials are stored in the database in plain text. Anyone with database access has
  them, so treat `DATABASE_URL` as being as sensitive as the API keys themselves.
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
| `npm run auth:hash` | Generate auth secrets for env-var-managed deploys |
