/**
 * Freshdesk API v2 client — just the calls the reply drafter needs.
 *
 * Authentication is HTTP Basic with an agent's API key as the username and any
 * password ("X" by convention). Everything posted is posted as that agent, so the key
 * decides whose name a customer sees on an automatic reply.
 */

export type FreshdeskCredentials = {
  /** The subdomain ("acme"), or a full acme.freshdesk.com host. */
  domain: string;
  apiKey: string;
};

export class FreshdeskError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(`Freshdesk: ${message}`);
  }
}

/** Accepts "acme", "acme.freshdesk.com" or a pasted https://acme.freshdesk.com/a/tickets URL. */
export function normalizeFreshdeskDomain(domain: string): string {
  const host = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return host.includes(".") ? host : `${host}.freshdesk.com`;
}

async function request<T>(
  credentials: FreshdeskCredentials,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<T> {
  const host = normalizeFreshdeskDomain(credentials.domain);
  const response = await fetch(`https://${host}/api/v2${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.apiKey}:X`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    let detail = text.slice(0, 300);
    try {
      const json = JSON.parse(text) as {
        description?: string;
        message?: string;
        errors?: { field?: string; message?: string }[];
      };
      const fields = json.errors
        ?.map((error) => [error.field, error.message].filter(Boolean).join(": "))
        .join("; ");
      detail = [json.description ?? json.message, fields].filter(Boolean).join(" — ") || detail;
    } catch {
      // Not JSON; keep the excerpt.
    }
    if (response.status === 401) {
      throw new FreshdeskError(
        "the API key was rejected. Copy it again from Profile settings → View API key.",
        401,
      );
    }
    if (response.status === 404) {
      throw new FreshdeskError(`not found (${path}). Check the helpdesk domain and ticket number.`, 404);
    }
    if (response.status === 429) {
      throw new FreshdeskError("rate limited. Try again in a minute.", 429);
    }
    throw new FreshdeskError(`${response.status} ${detail}`, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export type FreshdeskTicket = {
  id: number;
  subject: string | null;
  description_text: string | null;
  status: number;
  priority: number;
  tags: string[];
  spam?: boolean;
  created_at: string;
  requester_id: number;
  requester?: { id: number; name: string | null; email: string | null };
};

export type FreshdeskConversation = {
  id: number;
  body_text: string | null;
  /** True when the customer wrote it. */
  incoming: boolean;
  private: boolean;
  user_id: number;
  created_at: string;
};

export async function getTicket(
  credentials: FreshdeskCredentials,
  ticketId: number,
): Promise<FreshdeskTicket> {
  return request(credentials, "GET", `/tickets/${ticketId}?include=requester`);
}

/** Oldest first. Freshdesk caps a page at 100, which is far longer than any real thread. */
export async function getConversations(
  credentials: FreshdeskCredentials,
  ticketId: number,
): Promise<FreshdeskConversation[]> {
  const rows = await request<FreshdeskConversation[]>(
    credentials,
    "GET",
    `/tickets/${ticketId}/conversations?per_page=100`,
  );
  return [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** An internal note only agents can see. This is how a draft is delivered. */
export async function addPrivateNote(
  credentials: FreshdeskCredentials,
  ticketId: number,
  html: string,
): Promise<void> {
  await request(credentials, "POST", `/tickets/${ticketId}/notes`, { body: html, private: true });
}

/** A public reply, emailed to the customer. */
export async function sendReply(
  credentials: FreshdeskCredentials,
  ticketId: number,
  html: string,
): Promise<void> {
  await request(credentials, "POST", `/tickets/${ticketId}/reply`, { body: html });
}

/**
 * Adds tags without dropping the ones already there — Freshdesk's update replaces the
 * whole list. Best effort: an update can be refused for an unrelated required field
 * the ticket is missing, and that must not undo a draft that was already posted.
 */
export async function addTags(
  credentials: FreshdeskCredentials,
  ticket: FreshdeskTicket,
  tags: string[],
): Promise<void> {
  const merged = [...new Set([...(ticket.tags ?? []), ...tags])];
  if (merged.length === (ticket.tags ?? []).length) return;
  try {
    await request(credentials, "PUT", `/tickets/${ticket.id}`, { tags: merged });
  } catch {
    // Tags are a convenience for filtering views; the note or reply is what matters.
  }
}

/** Confirms the domain and key by reading the agent the key belongs to. */
export async function verifyCredentials(
  credentials: FreshdeskCredentials,
): Promise<{ name: string; email: string }> {
  const me = await request<{ contact?: { name?: string; email?: string } }>(
    credentials,
    "GET",
    "/agents/me",
  );
  return { name: me.contact?.name ?? "agent", email: me.contact?.email ?? "" };
}

/** Plain text from the model to the HTML Freshdesk expects, escaped. */
export function textToHtml(text: string): string {
  const escape = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escape(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
