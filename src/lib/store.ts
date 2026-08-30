import { prisma } from "@/lib/db";
import { DEFAULT_FEE_CONFIG } from "@/lib/fees";

/// Returns the active store, creating an empty one on first run so the UI always has a target.
export async function getActiveStore(storeId?: string) {
  const existing = storeId
    ? await prisma.store.findUnique({ where: { id: storeId }, include: { feeConfig: true } })
    : await prisma.store.findFirst({
        include: { feeConfig: true },
        orderBy: { createdAt: "asc" },
      });
  if (existing) return existing;

  return prisma.store.create({
    data: {
      name: "My Store",
      feeConfig: { create: DEFAULT_FEE_CONFIG },
    },
    include: { feeConfig: true },
  });
}

export async function listStores() {
  return prisma.store.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
}
