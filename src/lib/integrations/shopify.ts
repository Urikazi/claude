/**
 * Shopify Admin GraphQL client for custom apps.
 *
 * Install a custom app in the Shopify admin (Settings -> Apps and sales channels ->
 * Develop apps), grant `read_orders`, `read_products` and `read_all_orders`, then paste
 * the Admin API access token (`shpat_...`) into the dashboard settings page.
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
    const detail = await response.text();
    if (response.status === 401 || response.status === 400) {
      throw new ShopifyError(
        `could not mint an access token (${response.status}). Check the client ID and secret, ` +
          `and that the app and store belong to the same organization. ${detail}`,
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

const ORDERS_QUERY = `
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
        currentSubtotalPriceSet { shopMoney { amount } }
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

type MoneySet = { shopMoney: { amount: string } } | null;

function money(set: MoneySet): number {
  return set ? Number.parseFloat(set.shopMoney.amount) || 0 : 0;
}

export async function fetchOrders(
  credentials: ShopifyCredentials,
  since: Date,
): Promise<ShopifyOrder[]> {
  const orders: ShopifyOrder[] = [];
  let cursor: string | null = null;
  const filter = `processed_at:>=${since.toISOString()}`;

  // Shopify caps a single connection page at 250; 50 keeps us well inside the cost limit.
  for (let page = 0; page < 100; page += 1) {
    const data: {
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: {
          id: string;
          name: string;
          processedAt: string;
          displayFinancialStatus: string | null;
          currencyCode: string;
          paymentGatewayNames: string[];
          currentSubtotalPriceSet: MoneySet;
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
    } = await graphql(credentials, ORDERS_QUERY, { cursor, query: filter });

    for (const node of data.orders.nodes) {
      orders.push({
        id: node.id,
        name: node.name,
        processedAt: node.processedAt,
        displayFinancialStatus: node.displayFinancialStatus,
        currencyCode: node.currencyCode,
        paymentGatewayNames: node.paymentGatewayNames ?? [],
        subtotal: money(node.currentSubtotalPriceSet),
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
