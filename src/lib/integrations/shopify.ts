/**
 * Shopify Admin GraphQL client for custom apps.
 *
 * Install a custom app in the Shopify admin (Settings -> Apps and sales channels ->
 * Develop apps), grant `read_orders`, `read_products` and `read_all_orders`, then paste
 * the Admin API access token (`shpat_...`) into the dashboard settings page.
 */

export const SHOPIFY_API_VERSION = "2025-07";

export type ShopifyCredentials = {
  domain: string;
  accessToken: string;
};

class ShopifyError extends Error {
  constructor(message: string) {
    super(`Shopify: ${message}`);
  }
}

async function graphql<T>(
  credentials: ShopifyCredentials,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const domain = credentials.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": credentials.accessToken,
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
