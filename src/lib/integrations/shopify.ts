/**
 * Shopify Admin GraphQL client.
 *
 * Create an app in the Shopify Dev Dashboard with the `read_orders` and
 * `read_products` scopes, install it on the store, and put its client ID and secret
 * into the dashboard settings page. See `mintAccessToken` for how tokens are issued.
 */

/**
 * Shopify supports each API version for 12 months from release, so this needs a
 * bump roughly once a year. Check the current version in the app's dev dashboard.
 */
export const SHOPIFY_API_VERSION = "2026-07";

/**
 * Two ways to authenticate, in the order Shopify introduced them:
 *
 * - `clientId` + `clientSecret` — Dev Dashboard apps. There is no token to copy out
 *   of the UI; we mint one with the client credentials grant. Requires the app and
 *   the store to sit in the same Shopify organization.
 * - `accessToken` — legacy admin-created custom apps (`shpat_`), permanent. Shopify
 *   no longer lets you create these, but existing ones keep working.
 *
 * A stored access token wins, so an existing install keeps working untouched.
 */
export type ShopifyCredentials = {
  domain: string;
  accessToken?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
};

class ShopifyError extends Error {
  constructor(message: string) {
    super(`Shopify: ${message}`);
  }
}

export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

type CachedToken = { token: string; expiresAt: number };

/**
 * Client-credentials tokens last 24h, so minting one per API call would be a waste
 * of a round trip. Keyed by domain+client so several stores can cache side by side.
 */
const tokenCache = new Map<string, CachedToken>();

/** Refresh a little early rather than racing the expiry mid-sync. */
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/**
 * Shopify answers a failed token request with a full HTML error page, and pasting
 * that into the UI buries the one word that matters under a stylesheet. Pull out the
 * OAuth error code, falling back to the page title and then a short excerpt.
 */
export function summarizeOAuthError(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: string; error_description?: string };
    if (json.error) return json.error_description ?? json.error;
  } catch {
    // Not JSON; fall through to the HTML shapes below.
  }
  const oauth = body.match(/Oauth error (\w+)/i);
  if (oauth) return oauth[1];
  const title = body.match(/<title>([^<]{0,200})<\/title>/i);
  if (title) return title[1].trim();
  return body.replace(/\s+/g, " ").slice(0, 200);
}

async function mintAccessToken(
  domain: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const cacheKey = `${domain}:${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const response = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    const detail = summarizeOAuthError(body);

    // The usual cause: the app exists in the Dev Dashboard but was never installed on
    // this store. Client credentials only work against a store the app is installed on.
    if (body.includes("app_not_installed")) {
      throw new ShopifyError(
        `the app is not installed on ${domain}. Install it on the store from the Dev ` +
          `Dashboard, then sync again.`,
      );
    }
    if (detail === "invalid_client" || detail === "invalid_request") {
      throw new ShopifyError(
        `the client ID or secret was rejected (${detail}). If you revoked or rotated the ` +
          `secret in the Dev Dashboard, generate a new one and paste it into the client ` +
          `secret field — the stored one is no longer valid.`,
      );
    }
    if (response.status === 401 || response.status === 400) {
      throw new ShopifyError(
        `could not mint an access token (${response.status}: ${detail}). Check the client ID ` +
          `and secret, and that the app and store belong to the same organization.`,
      );
    }
    throw new ShopifyError(`token request failed: ${response.status} ${detail}`);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token) throw new ShopifyError("token response had no access_token");

  // Shopify returns 86399s; fall back to that if the field is ever missing.
  const lifetimeMs = (payload.expires_in ?? 86399) * 1000;
  tokenCache.set(cacheKey, {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(lifetimeMs - TOKEN_EXPIRY_MARGIN_MS, 0),
  });
  return payload.access_token;
}

async function resolveAccessToken(credentials: ShopifyCredentials): Promise<string> {
  if (credentials.accessToken) return credentials.accessToken;

  const { clientId, clientSecret } = credentials;
  if (clientId && clientSecret) {
    return mintAccessToken(normalizeDomain(credentials.domain), clientId, clientSecret);
  }

  throw new ShopifyError(
    "no credentials configured. Add the client ID and secret from your app's Dev Dashboard settings.",
  );
}


async function graphql<T>(
  credentials: ShopifyCredentials,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const domain = normalizeDomain(credentials.domain);
  const accessToken = await resolveAccessToken(credentials);
  const response = await fetch(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new ShopifyError(`${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    data?: T;
    errors?: { message: string }[];
  };

  if (payload.errors?.length) {
    throw new ShopifyError(payload.errors.map((e) => e.message).join("; "));
  }
  if (!payload.data) throw new ShopifyError("empty response");
  return payload.data;
}

export type ShopifyOrder = {
  id: string;
  name: string;
  processedAt: string;
  displayFinancialStatus: string | null;
  shippingCountry: string | null;
  customerId: string | null;
  currencyCode: string;
  paymentGatewayNames: string[];
  subtotal: number;
  discounts: number;
  shipping: number;
  tax: number;
  total: number;
  refunded: number;
  lineItems: {
    id: string;
    title: string;
    variantTitle: string | null;
    variantId: string | null;
    sku: string | null;
    quantity: number;
    unitPrice: number;
    discountAllocated: number;
  }[];
};

/**
 * Reading `customer` needs protected customer data approval, which a store may not have
 * granted. The field is therefore optional: the sync asks for it, and drops it for the
 * rest of the run if Shopify refuses, so revenue keeps syncing without new/returning
 * customer analysis rather than failing outright.
 */
const ordersQuery = (withCustomer: boolean) => `
  query Orders($cursor: String, $query: String!) {
    orders(first: 50, after: $cursor, query: $query, sortKey: PROCESSED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        processedAt
        displayFinancialStatus
        currencyCode
        paymentGatewayNames
        shippingAddress { countryCodeV2 }
        ${withCustomer ? "customer { id }" : ""}
        # The original subtotal, not currentSubtotalPriceSet: the "current" fields are
        # net of returns and edits while totalPriceSet is not, and mixing the two leaves
        # a breakdown that cannot add up to its own total. Refunds are subtracted once,
        # explicitly, from the order total instead.
        subtotalPriceSet { shopMoney { amount } }
        totalDiscountsSet { shopMoney { amount } }
        totalShippingPriceSet { shopMoney { amount } }
        totalTaxSet { shopMoney { amount } }
        totalPriceSet { shopMoney { amount } }
        totalRefundedSet { shopMoney { amount } }
        lineItems(first: 100) {
          nodes {
            id
            title
            sku
            quantity
            variantTitle
            variant { id }
            originalUnitPriceSet { shopMoney { amount } }
            totalDiscountSet { shopMoney { amount } }
          }
        }
      }
    }
  }
`;

/** Whether Shopify refused a field for want of protected customer data access. */
function isProtectedDataError(error: unknown): boolean {
  if (!(error instanceof ShopifyError)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("protected customer data") ||
    message.includes("not approved to access") ||
    (message.includes("access denied") && message.includes("customer"))
  );
}

type MoneySet = { shopMoney: { amount: string } } | null;

function money(set: MoneySet): number {
  return set ? Number.parseFloat(set.shopMoney.amount) || 0 : 0;
}

type OrdersResponse = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      id: string;
      name: string;
      processedAt: string;
      displayFinancialStatus: string | null;
      shippingAddress: { countryCodeV2: string | null } | null;
      customer: { id: string } | null;
      currencyCode: string;
      paymentGatewayNames: string[];
      subtotalPriceSet: MoneySet;
      totalDiscountsSet: MoneySet;
      totalShippingPriceSet: MoneySet;
      totalTaxSet: MoneySet;
      totalPriceSet: MoneySet;
      totalRefundedSet: MoneySet;
      lineItems: {
        nodes: {
          id: string;
          title: string;
          sku: string | null;
          quantity: number;
          variantTitle: string | null;
          variant: { id: string } | null;
          originalUnitPriceSet: MoneySet;
          totalDiscountSet: MoneySet;
        }[];
      };
    }[];
  };
};

/**
 * `updatedSince` filters on when Shopify last touched the order rather than when it
 * was placed, so an incremental sync still picks up refunds and edits made to older
 * orders. `since` alone would miss them.
 */
export async function fetchOrders(
  credentials: ShopifyCredentials,
  since: Date,
  updatedSince?: Date,
): Promise<ShopifyOrder[]> {
  const orders: ShopifyOrder[] = [];
  let cursor: string | null = null;
  let withCustomer = true;
  const filter = updatedSince
    ? `updated_at:>=${updatedSince.toISOString()}`
    : `processed_at:>=${since.toISOString()}`;

  // Shopify caps a single connection page at 250; 50 keeps us well inside the cost limit.
  for (let page = 0; page < 100; page += 1) {
    const data: OrdersResponse = await graphql<OrdersResponse>(
      credentials,
      ordersQuery(withCustomer),
      { cursor, query: filter },
    ).catch((error: unknown) => {
      // Retried once and then remembered, so a store without the approval pays for one
      // failed request rather than one per page.
      if (withCustomer && isProtectedDataError(error)) {
        withCustomer = false;
        return graphql<OrdersResponse>(credentials, ordersQuery(false), {
          cursor,
          query: filter,
        });
      }
      throw error;
    });

    for (const node of data.orders.nodes) {
      orders.push({
        id: node.id,
        name: node.name,
        processedAt: node.processedAt,
        displayFinancialStatus: node.displayFinancialStatus,
        shippingCountry: node.shippingAddress?.countryCodeV2 ?? null,
        customerId: node.customer?.id ?? null,
        currencyCode: node.currencyCode,
        paymentGatewayNames: node.paymentGatewayNames ?? [],
        subtotal: money(node.subtotalPriceSet),
        discounts: money(node.totalDiscountsSet),
        shipping: money(node.totalShippingPriceSet),
        tax: money(node.totalTaxSet),
        total: money(node.totalPriceSet),
        refunded: money(node.totalRefundedSet),
        lineItems: node.lineItems.nodes.map((item) => ({
          id: item.id,
          title: item.title,
          variantTitle: item.variantTitle,
          variantId: item.variant?.id ?? null,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: money(item.originalUnitPriceSet),
          discountAllocated: money(item.totalDiscountSet),
        })),
      });
    }

    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  return orders;
}

export type ShopifyProduct = {
  id: string;
  title: string;
  handle: string;
  imageUrl: string | null;
  variants: {
    id: string;
    title: string;
    sku: string | null;
    price: number;
    /// Shopify's own inventory unit cost, used to pre-fill COGS when the user has it set.
    unitCost: number | null;
  }[];
};

const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        featuredImage { url }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            inventoryItem { unitCost { amount } }
          }
        }
      }
    }
  }
`;

export async function fetchProducts(
  credentials: ShopifyCredentials,
): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 100; page += 1) {
    const data: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: {
          id: string;
          title: string;
          handle: string;
          featuredImage: { url: string } | null;
          variants: {
            nodes: {
              id: string;
              title: string;
              sku: string | null;
              price: string;
              inventoryItem: { unitCost: { amount: string } | null } | null;
            }[];
          };
        }[];
      };
    } = await graphql(credentials, PRODUCTS_QUERY, { cursor });

    for (const node of data.products.nodes) {
      products.push({
        id: node.id,
        title: node.title,
        handle: node.handle,
        imageUrl: node.featuredImage?.url ?? null,
        variants: node.variants.nodes.map((variant) => ({
          id: variant.id,
          title: variant.title,
          sku: variant.sku,
          price: Number.parseFloat(variant.price) || 0,
          unitCost: variant.inventoryItem?.unitCost
            ? Number.parseFloat(variant.inventoryItem.unitCost.amount) || 0
            : null,
        })),
      });
    }

    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  return products;
}

export async function verifyCredentials(credentials: ShopifyCredentials) {
  const data = await graphql<{ shop: { name: string; currencyCode: string } }>(
    credentials,
    `query { shop { name currencyCode } }`,
  );
  return data.shop;
}

/**
 * Daily store sessions, the denominator of conversion rate.
 *
 * Sessions are analytics rather than commerce data, so they come from ShopifyQL
 * instead of the orders API. That needs the `read_reports` scope, which a store may not
 * have granted; `SessionsUnavailableError` distinguishes that from a real failure so
 * the sync can report what to add rather than reading as broken.
 */
export class SessionsUnavailableError extends Error {}

const SESSIONS_QUERY = `
  query Sessions($query: String!) {
    shopifyqlQuery(query: $query) {
      __typename
      ... on TableResponse {
        tableData {
          columns { name dataType displayName }
          rowData
        }
      }
      parseErrors { code message }
    }
  }
`;

export async function fetchDailySessions(
  credentials: ShopifyCredentials,
  since: Date,
  until: Date,
): Promise<{ day: string; sessions: number }[]> {
  const from = since.toISOString().slice(0, 10);
  const to = until.toISOString().slice(0, 10);
  // Dates are pinned rather than relative so the window matches the sync's own range.
  const ql = `FROM sessions SHOW sessions TIMESERIES day SINCE ${from} UNTIL ${to} ORDER BY day ASC`;

  let data: {
    shopifyqlQuery: {
      __typename: string;
      tableData?: {
        columns: { name: string; dataType: string; displayName: string }[];
        rowData: string[][];
      } | null;
      parseErrors?: { code: string; message: string }[] | null;
    } | null;
  };
  try {
    data = await graphql(credentials, SESSIONS_QUERY, { query: ql });
  } catch (error) {
    if (error instanceof ShopifyError && isReportsAccessError(error)) {
      throw new SessionsUnavailableError(
        "Shopify did not allow reading analytics. Add the read_reports scope to your app, release a new version and reinstall it, then sync sessions again.",
      );
    }
    throw error;
  }

  const result = data.shopifyqlQuery;
  if (!result) throw new SessionsUnavailableError("Shopify returned no analytics data.");
  if (result.parseErrors?.length) {
    throw new ShopifyError(
      `analytics query rejected: ${result.parseErrors.map((e) => e.message).join("; ")}`,
    );
  }
  const table = result.tableData;
  if (!table) return [];

  // Columns are addressed by name rather than position, which ShopifyQL does not promise.
  const dayIndex = table.columns.findIndex((column) => column.name === "day");
  const sessionsIndex = table.columns.findIndex((column) => column.name === "sessions");
  if (dayIndex < 0 || sessionsIndex < 0) {
    throw new ShopifyError(
      `analytics response missing day/sessions columns (got ${table.columns.map((c) => c.name).join(", ")})`,
    );
  }

  const rows: { day: string; sessions: number }[] = [];
  for (const row of table.rowData ?? []) {
    // ShopifyQL dates come back as "2026-08-30" or a full timestamp; keep the day.
    const day = String(row[dayIndex] ?? "").slice(0, 10);
    const sessions = Number.parseInt(String(row[sessionsIndex] ?? "0"), 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(sessions)) {
      rows.push({ day, sessions });
    }
  }
  return rows;
}

/** Whether Shopify refused the analytics query for want of the read_reports scope. */
function isReportsAccessError(error: ShopifyError): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("read_reports") ||
    message.includes("access denied") ||
    message.includes("not approved") ||
    message.includes("required access")
  );
}
