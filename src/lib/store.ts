import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { DEFAULT_FEE_CONFIG } from "@/lib/fees";

/**
 * Which store the dashboard is currently showing.
 *
 * Held in a cookie rather than the URL so a switch follows you across every report
 * instead of having to be carried on each link, and so a bookmarked page shows the
 * store you were last looking at.
 */
export const ACTIVE_STORE_COOKIE = "active_store";

/// Returns the active store, creating an empty one on first run so the UI always has a target.
export async function getActiveStore(storeId?: string) {
  const selected = storeId ?? (await cookies()).get(ACTIVE_STORE_COOKIE)?.value;

  if (selected) {
    const chosen = await prisma.store.findUnique({
      where: { id: selected },
      include: { feeConfig: true },
    });
    // A cookie outliving the store it names must not leave the dashboard empty.
    if (chosen) return chosen;
  }

  const first = await prisma.store.findFirst({
    include: { feeConfig: true },
    orderBy: { createdAt: "asc" },
  });
  if (first) return first;

  return prisma.store.create({
    data: {
      name: "My Store",
      feeConfig: { create: DEFAULT_FEE_CONFIG },
    },
    include: { feeConfig: true },
  });
}

export async function listStores() {
  return prisma.store.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
}
