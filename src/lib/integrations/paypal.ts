/**
 * PayPal transaction-search reader.
 *
 * Create a REST app in the PayPal developer dashboard and enable "Transaction Search" on it.
 * The reported fee is the real amount PayPal deducted, so it replaces our estimate.
 */

export type PayPalCredentials = {
  clientId: string;
  clientSecret: string;
  live: boolean;
};

export type PayPalTransaction = {
  id: string;
  date: Date;
  amount: number;
  fee: number;
  orderRef: string | null;
};

class PayPalError extends Error {
  constructor(message: string) {
    super(`PayPal: ${message}`);
  }
}

function baseUrl(live: boolean): string {
  return live ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function getAccessToken(credentials: PayPalCredentials): Promise<string> {
  const basic = Buffer.from(
    `${credentials.clientId}:${credentials.clientSecret}`,
  ).toString("base64");

  const response = await fetch(`${baseUrl(credentials.live)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new PayPalError(`auth ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as { access_token: string };
  return payload.access_token;
}

type TransactionRow = {
  transaction_info: {
    transaction_id: string;
    transaction_initiation_date: string;
    transaction_amount?: { value: string };
    fee_amount?: { value: string };
    invoice_id?: string;
    custom_field?: string;
  };
};

function extractOrderRef(info: TransactionRow["transaction_info"]): string | null {
  for (const candidate of [info.invoice_id, info.custom_field]) {
    if (!candidate) continue;
    const match = candidate.match(/#?(\d{3,})/);
    if (match) return `#${match[1]}`;
  }
  return null;
}

export async function fetchTransactions(
  credentials: PayPalCredentials,
  since: Date,
  until: Date,
): Promise<PayPalTransaction[]> {
  const token = await getAccessToken(credentials);
  const transactions: PayPalTransaction[] = [];

  // Transaction Search only accepts a 31-day window per call, so walk the range in chunks.
  for (const window of monthlyWindows(since, until)) {
    let page = 1;
    for (let guard = 0; guard < 100; guard += 1) {
      const params = new URLSearchParams({
        start_date: window.from.toISOString(),
        end_date: window.to.toISOString(),
        fields: "transaction_info",
        page_size: "500",
        page: page.toString(),
      });

      const response = await fetch(
        `${baseUrl(credentials.live)}/v1/reporting/transactions?${params}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      if (!response.ok) {
        throw new PayPalError(`${response.status} ${await response.text()}`);
      }

      const payload = (await response.json()) as {
        transaction_details?: TransactionRow[];
        total_pages?: number;
      };

      for (const row of payload.transaction_details ?? []) {
        const info = row.transaction_info;
        transactions.push({
          id: info.transaction_id,
          date: new Date(info.transaction_initiation_date),
          amount: Number.parseFloat(info.transaction_amount?.value ?? "0") || 0,
          // PayPal reports the fee as a negative number.
          fee: Math.abs(Number.parseFloat(info.fee_amount?.value ?? "0") || 0),
          orderRef: extractOrderRef(info),
        });
      }

      if (!payload.total_pages || page >= payload.total_pages) break;
      page += 1;
    }
  }

  return transactions;
}

function monthlyWindows(since: Date, until: Date): { from: Date; to: Date }[] {
  const windows: { from: Date; to: Date }[] = [];
  let cursor = new Date(since);
  for (let i = 0; i < 40 && cursor < until; i += 1) {
    const next = new Date(cursor);
    next.setUTCDate(next.getUTCDate() + 30);
    windows.push({ from: new Date(cursor), to: next > until ? until : next });
    cursor = next;
  }
  return windows;
}

export async function verifyCredentials(credentials: PayPalCredentials) {
  await getAccessToken(credentials);
  return { ok: true };
}
