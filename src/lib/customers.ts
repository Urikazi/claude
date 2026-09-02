import { prisma } from "@/lib/db";

/**
 * Which orders were a customer's first.
 *
 * Deriving this from the earliest order we hold is only right when we hold all of them.
 * A store with subscription renewals breaks that: the renewal is synced, the original
 * purchase happened long before our window, and the renewal reads as a first purchase.
 * Every such customer is then counted as new, which is how a day with twenty-two new
 * customers reported forty-nine.
 *
 * So Shopify's own lifetime count decides wherever it is available:
 *
 *   - it says one           → their only order ever, so this is the first
 *   - it says more, and we  → our earliest is genuinely their first
 *     hold that many
 *   - it says more, and we  → their history starts before ours; not a first purchase,
 *     hold fewer              which is the case that was being counted as one
 *
 * Only where Shopify said nothing does the earliest order we hold decide, which is the
 * old behaviour and the best available then.
 */
export async function firstOrderIds(storeId: string): Promise<Set<string>> {
  const orders = await prisma.order.findMany({
    where: { storeId, customerId: { not: null } },
    select: { id: true, customerId: true, processedAt: true, customerOrderCount: true },
    orderBy: { processedAt: "asc" },
  });

  // How many we hold per customer, and what Shopify last said they had in total.
  const held = new Map<string, number>();
  const lifetime = new Map<string, number>();
  for (const order of orders) {
    const customer = order.customerId!;
    held.set(customer, (held.get(customer) ?? 0) + 1);
    if (order.customerOrderCount !== null) {
      lifetime.set(customer, Math.max(lifetime.get(customer) ?? 0, order.customerOrderCount));
    }
  }

  const seen = new Set<string>();
  const first = new Set<string>();
  for (const order of orders) {
    const customer = order.customerId!;
    const earliestWeHold = !seen.has(customer);
    seen.add(customer);

    const total = lifetime.get(customer);
    if (total === undefined) {
      // Nothing from Shopify: fall back to our own history.
      if (earliestWeHold) first.add(order.id);
      continue;
    }
    if (total <= 1) {
      if (earliestWeHold) first.add(order.id);
      continue;
    }
    // They have more orders than this one. Ours is their first only if we hold them all.
    if (earliestWeHold && (held.get(customer) ?? 0) >= total) first.add(order.id);
  }
  return first;
}

/**
 * Orders we cannot classify: a customer whose history starts before ours, where Shopify
 * has not said how many orders they have. Counting these as new is what overstates the
 * new customer rate, so the pages that report it say how many there are.
 */
export async function unclassifiableOrderCount(storeId: string): Promise<number> {
  return prisma.order.count({
    where: { storeId, customerId: null },
  });
}
