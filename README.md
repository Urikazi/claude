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
| COGS by quantity | Entered per variant, or imported as a supplier price list |
| Sessions and conversion rate | Shopify analytics via ShopifyQL (`read_reports`) |

Revenue is reported as **Total sales**, computed the way Shopify computes it — gross sales less
discounts and returns, plus shipping and tax — and broken out on the overview so it can be
reconciled against Shopify line by line. Anything the named rows do not cover, such as duties or
tips, appears as its own row rather than being folded silently into another.

The Ad spend page also reproduces **Meta's own figures** — Purchase ROAS and cost per purchase,
exactly as Ads Manager shows them. Meta counts a sale when its attribution claims one, over its own
window, so those numbers will not agree with the Shopify-derived ones beside them and are not meant
to. Attributed value is stored per day and divided at the end, never averaged: a ratio of totals,
not a mean of ratios.

What that conversion counts is yours to declare, and **Ads Manager reports new customers only** is on
by default: a store connecting Meta at all is running acquisition, and the figure its own reporting
shows is the one it steers by. With it on, nc-ROAS and cost per new customer are Meta's own numbers.
Untick it where the ad account optimises for every purchase, and both revert to figures worked out
from Shopify orders — a first purchase being one with no earlier order from that customer.

Return on ad spend is reported as **nc-ROAS** — new customer revenue over ad spend — alongside the
blended figure. Ads buy first purchases; blended ROAS credits them with repeat orders that would
have come anyway, so it reads high on a store with returning customers and moves for reasons the
spend had nothing to do with. **Cost per new customer** is the same idea from the other side. Both
are withheld rather than guessed when orders carry no customer.

The profit calculation:

```
total sales      = order total − refunds
gross profit     = total sales − COGS − processing fees − Shopify fees
net profit       = gross profit − ad spend
```

COGS is looked up per order rather than multiplied per unit: a supplier quoting 6.59 for one and
9.99 for two is charging for a parcel, not a rate.

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
`read_orders`, `read_products`, `read_customers` and `read_reports` scopes, release a version, and
**install it on your store** —
the grant only works against a store the app is installed on. Then open App settings →
Credentials and copy the Client ID and a Secret into the settings page along with your
`*.myshopify.com` domain. Access tokens are minted automatically and refreshed every 24 hours.

`read_reports` allows sessions to be read, which conversion rate divides by; without it everything
else still works and conversion falls back to ad clicks. `read_customers` allows the customer on an
order to be read, and so a first purchase to be told from a repeat; without it orders still sync,
conversion is reported blended, and nc-ROAS is withheld.

Adding a scope changes only what the app asks for. The store grants it at install, so a new version
must be released **and** the app reinstalled before anything changes — until then Shopify keeps
refusing a scope the dashboard plainly lists.

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

Ordinary syncs only fetch what Shopify has touched since the last one. After granting a new scope,
use **Re-import every order in the window** in settings: orders already stored have not changed, so
an incremental sync skips them and the newly permitted field never arrives on your history.

## Entering COGS

Go to **Products & COGS**. Each variant takes a **cost per unit** — what one item costs you —
and any number of **bundle costs**, each naming a quantity and what that many cost **in total**.

Fulfilment agents quote it this way because a parcel ships once: two units cost less than twice
one. Entering 2 → 9.99 records the whole line at 9.99 rather than 2 × 6.59, which is the
difference between a real profit figure and one that is several dollars light on every
multi-unit order.

Quantities between the ones you enter are interpolated. Past the largest bundle, cost
extrapolates at that bundle's marginal rate — the cost of one more unit once shipping is already
paid — rather than at the single-unit price.

Orders are costed as a whole, not line by line. A buy-one-get-one that arrives as two lines of
one unit is priced as a single two-unit parcel, so offers and post-purchase upsells cost what the
supplier actually charges however the storefront happens to record them.

Variants whose SKU carries a suffix (`FL2600896-M`) fall back to the family SKU (`FL2600896`)
when that is priced, since a shade or size rarely changes what the supplier charges.

Variants without a cost sort to the top of the list, and the overview warns you while any
remain — profit is overstated until they are filled in.

For a supplier who quotes by destination, import a price list instead: it holds a table per SKU,
country and quantity, and country-specific prices win over anything typed per product. Use
**Re-apply costs to past orders** in settings to push changes onto history.

## Conversion rate and the change log

**Conversion rate** reports new customer orders per session, and only those: a landing page or a
creative is judged on strangers, and a repeat buyer converts for reasons neither had any part in.
Repeat orders are counted and named so you can see what is being left out, but they are not in the
rate. Blended stands in only where first purchases cannot be identified at all.

Every edit you make — a price, a creative, a rewritten page — can be logged with the day it went
live. Each one is marked on the chart and compared against an equal number of days either side,
stopping at the next change so two edits are never mixed into one reading.

The comparison reports whether a move is larger than the order counts alone would throw up by
chance. That is not proof: a logged change is not a controlled experiment, and traffic mix, spend
and season move conversion too. Treat "likely better" as worth a closer look, not as a result.

Revenue is never filtered by customer type — the P&L counts every order, repeat buyers included.
The split on this page divides that same total so you can see where it came from. The header shows
how long ago orders were last pulled in, since a dashboard that disagrees with Shopify's live view
is usually behind it rather than wrong.

Whether a customer is new is worked out from the earliest order held for them, not from Shopify's
lifetime order count, which describes the customer today and would relabel past orders every time
someone bought again. Customers whose first purchase predates your synced history therefore read
as new, and so do those whose earlier orders were synced before `read_customers` was granted —
nothing links an unattributed order to its buyer. The page counts those orders and says so, since
both cases undercount returning customers rather than failing visibly.

## Checking supplier invoices

Upload the daily order export your supplier bills from, at **Supplier invoices**, and every line is
priced against the list you imported. What matches is not shown; what does not is listed with the
billed amount, the quoted one and the difference.

A line is checked only where the price list quotes that SKU for that destination. A product quoted
at one rate everywhere is checked wherever it ships; one quoted country by country is left alone in
a country the list says nothing about, because the only comparison available there is against a
price nobody agreed for it — and reporting that as an overcharge would make every unquoted country
look like a dispute.

The free half of a two-for-one arrives as a line billed for zero units, so its expected cost is
zero: an amount against it is an overcharge, not a discount lost. The invoice's own stated total is
checked against the sum of its lines as well, since the two disagreeing is worth knowing before any
individual price is.

Invoices are kept, so a rate creeping up shows across weeks rather than having to be caught on the
day.

## Automating the sync

Point any scheduler at the sync endpoint:

```bash
curl -X POST https://your-app/api/sync
curl -X POST "https://your-app/api/sync?source=meta&days=7"
```

Sources are `shopify-products`, `shopify-orders`, `shopify-sessions`, `meta` and `fees`; omit
`source` to run all five.
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
- The dashboard reports in the store's own time zone, read from Shopify on every order sync, so a
  day here is the same day there. A mismatch is invisible in the totals and shows up only as
  missing revenue: a store reporting on UTC against a Paris shop drops every order placed in the
  first hours of the day.
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
