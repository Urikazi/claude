import { prisma } from "@/lib/db";
import { getActiveStore } from "@/lib/store";
import { resolveRange } from "@/lib/format";
import { Card, Empty, Th } from "@/components/ui";
import { CogsRow, type VariantRow } from "@/components/cogs-row";

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; q?: string }>;
}) {
  const { range: rangeParam, q } = await searchParams;
  const range = resolveRange(rangeParam);
  const store = await getActiveStore();
  const search = q?.trim();

  const products = await prisma.product.findMany({
    where: {
      storeId: store.id,
      ...(search ? { title: { contains: search } } : {}),
    },
    include: { variants: { orderBy: { title: "asc" } } },
    orderBy: { title: "asc" },
  });

  // Units sold per variant over the range, so the operator can prioritise what to cost first.
  const sold = await prisma.orderLineItem.groupBy({
    by: ["variantId"],
    where: {
      order: { storeId: store.id, processedAt: { gte: range.from, lte: range.to } },
      variantId: { not: null },
    },
    _sum: { quantity: true },
  });
  const unitsByVariant = new Map(
    sold.map((row) => [row.variantId!, row._sum.quantity ?? 0]),
  );

  const rows: VariantRow[] = products.flatMap((product) =>
    product.variants.map((variant) => ({
      id: variant.id,
      productTitle: product.title,
      variantTitle: variant.title,
      sku: variant.sku,
      price: variant.price,
      cogs: variant.cogs,
      shippingCost: variant.shippingCost,
      handlingCost: variant.handlingCost,
      unitsSold: unitsByVariant.get(variant.id) ?? 0,
    })),
  );

  // Best-sellers without a cost are the most expensive gap in the P&L, so surface them first.
  rows.sort((a, b) => {
    if (a.cogs === 0 && b.cogs !== 0) return -1;
    if (b.cogs === 0 && a.cogs !== 0) return 1;
    return b.unitsSold - a.unitsSold;
  });

  const missing = rows.filter((row) => row.cogs === 0).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Products &amp; COGS</h1>
        <p className="mt-0.5 text-sm text-muted">
          Enter unit costs here. They are deducted from every order containing the variant, past
          and future.
        </p>
      </div>

      <Card
        title={`${rows.length} variants · ${missing} without a cost`}
        action={
          <form className="flex gap-2">
            <input
              name="q"
              defaultValue={search ?? ""}
              placeholder="Search products…"
              className="w-56 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
          </form>
        }
      >
        {rows.length === 0 ? (
          <Empty>
            No products yet. Add your Shopify credentials in Settings and run a sync, or seed demo
            data with <code className="text-accent">npm run db:seed</code>.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">Units</Th>
                  <Th align="right">COGS</Th>
                  <Th align="right">Shipping</Th>
                  <Th align="right">Handling</Th>
                  <Th align="right">Unit margin</Th>
                  <Th align="right">&nbsp;</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((variant) => (
                  <CogsRow key={variant.id} variant={variant} currency={store.currency} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
