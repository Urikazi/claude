import { prisma } from "@/lib/db";

/**
 * Which orders were a customer's first.
 *
 * Taken from the earliest order we hold per customer rather than from Shopify's
 * lifetime order count, which describes the customer today rather than at the moment
 * of the order and would relabel every past order the moment someone bought again.
 *
 * Orders synced from a window that starts after a customer's real first purchase will
 * read as new, as will those stored before the app could read customers at all.
 *
 * Lives apart from both the P&L and the conversion report because both need it and
 * neither owns it.
 */
export async function firstOrderIds(storeId: string): Promise<Set<string>> {
  const orders = await prisma.order.findMany({
    where: { storeId, customerId: { not: null } },
    select: { id: true, customerId: true, processedAt: true },
    orderBy: { processedAt: "asc" },
  });
  const seen = new Set<string>();
  const first = new Set<string>();
  for (const order of orders) {
    if (seen.has(order.customerId!)) continue;
    seen.add(order.customerId!);
    first.add(order.id);
  }
  return first;
}
