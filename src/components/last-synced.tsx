import { prisma } from "@/lib/db";
import { timeAgo } from "@/lib/format";

/** Orders older than this are worth flagging: the store has moved on without us. */
const STALE_MS = 2 * 60 * 60 * 1000;

/**
 * When orders were last pulled in.
 *
 * Without this the dashboard looks simply wrong whenever it is compared against
 * Shopify's live view: the numbers differ because the sync has not run, not because
 * anything is being left out, and there was no way to tell those apart.
 */
export async function LastSynced({ storeId }: { storeId: string }) {
  const last = await prisma.syncLog.findFirst({
    where: { storeId, source: "shopify-orders", status: "success" },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });

  if (!last) {
    return <span className="text-xs text-muted">Orders never synced</span>;
  }

  // Read once so the label and the staleness test agree; this is a server component
  // rendered per request, so the clock is the right source.
  const renderedAt = new Date();
  const stale = renderedAt.getTime() - last.startedAt.getTime() > STALE_MS;
  return (
    <span
      className={`text-xs ${stale ? "text-amber-300" : "text-muted"}`}
      title={`Orders last synced ${last.startedAt.toISOString()}`}
    >
      Orders synced {timeAgo(last.startedAt, renderedAt)}
      {stale ? " — newer orders are not counted yet" : ""}
    </span>
  );
}
