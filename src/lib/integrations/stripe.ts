/**
 * Stripe balance-transaction reader.
 *
 * We only need the real fee Stripe charged, so this hits the REST API directly rather than
 * pulling in the SDK. Use a restricted key with read access to charges and balance transactions.
 */

export type StripeCredentials = { secretKey: string };

export type StripeCharge = {
  id: string;
  created: Date;
  amount: number;
  fee: number;
  net: number;
  /// Shopify writes its order name (#1001) into the charge description or metadata.
  orderRef: string | null;
};

class StripeError extends Error {
  constructor(message: string) {
    super(`Stripe: ${message}`);
  }
}

type ChargeRow = {
  id: string;
  created: number;
  amount: number;
  currency: string;
  description: string | null;
  metadata?: Record<string, string>;
  balance_transaction: { fee: number; net: number } | string | null;
};

/// Pulls "#1001" style order references out of whatever field Shopify populated.
function extractOrderRef(charge: ChargeRow): string | null {
  const candidates = [
    charge.metadata?.order_name,
    charge.metadata?.shopify_order_name,
    charge.metadata?.order_id,
    charge.description,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = candidate.match(/#?(\d{3,})/);
    if (match) return `#${match[1]}`;
  }
  return null;
}

export async function fetchCharges(
  credentials: StripeCredentials,
  since: Date,
): Promise<StripeCharge[]> {
  const charges: StripeCharge[] = [];
  let startingAfter: string | null = null;

  for (let page = 0; page < 100; page += 1) {
    const params = new URLSearchParams({
      limit: "100",
      "created[gte]": Math.floor(since.getTime() / 1000).toString(),
      // Inlines the fee so we do not need a second round trip per charge.
      "expand[]": "data.balance_transaction",
    });
    if (startingAfter) params.set("starting_after", startingAfter);

    const response = await fetch(`https://api.stripe.com/v1/charges?${params}`, {
      headers: { Authorization: `Bearer ${credentials.secretKey}` },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new StripeError(`${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      data: ChargeRow[];
      has_more: boolean;
    };

    for (const charge of payload.data) {
      const balance =
        typeof charge.balance_transaction === "object" && charge.balance_transaction
          ? charge.balance_transaction
          : null;
      charges.push({
        id: charge.id,
        created: new Date(charge.created * 1000),
        // Stripe reports minor units (cents).
        amount: charge.amount / 100,
        fee: (balance?.fee ?? 0) / 100,
        net: (balance?.net ?? 0) / 100,
        orderRef: extractOrderRef(charge),
      });
    }

    if (!payload.has_more || payload.data.length === 0) break;
    startingAfter = payload.data[payload.data.length - 1].id;
  }

  return charges;
}

export async function verifyCredentials(credentials: StripeCredentials) {
  const response = await fetch("https://api.stripe.com/v1/balance", {
    headers: { Authorization: `Bearer ${credentials.secretKey}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new StripeError(`${response.status} ${await response.text()}`);
  }
  return { ok: true };
}
