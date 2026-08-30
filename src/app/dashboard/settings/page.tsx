import { prisma } from "@/lib/db";
import { getActiveStore } from "@/lib/store";
import { toFeeRates } from "@/lib/fees";
import { formatDate } from "@/lib/format";
import { Card, Empty, Td, Th } from "@/components/ui";
import { ConnectionsForm, FeeForm, SyncPanel } from "@/components/settings-forms";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const store = await getActiveStore();
  const logs = await prisma.syncLog.findMany({
    where: { storeId: store.id },
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-0.5 text-sm text-muted">
          Credentials are stored in your own database and never leave this server.
        </p>
      </div>

      <Card title="Connections">
        <ConnectionsForm
          store={{
            id: store.id,
            name: store.name,
            currency: store.currency,
            shopifyDomain: store.shopifyDomain,
            metaAdAccountId: store.metaAdAccountId,
            paypalClientId: store.paypalClientId,
            paypalLiveMode: store.paypalLiveMode,
            shopifyClientId: store.shopifyClientId,
            hasShopifyToken: Boolean(store.shopifyAccessToken),
            hasShopifyClientSecret: Boolean(store.shopifyClientSecret),
            hasMetaToken: Boolean(store.metaAccessToken),
            hasStripeKey: Boolean(store.stripeSecretKey),
            hasPaypalSecret: Boolean(store.paypalClientSecret),
          }}
        />
      </Card>

      <Card title="Fees">
        <FeeForm storeId={store.id} fees={toFeeRates(store.feeConfig)} />
      </Card>

      <SyncPanel storeId={store.id} />

      <Card title="Automating the sync">
        <p className="text-sm text-muted">
          Point any scheduler at <code className="text-accent">POST /api/sync</code> to refresh
          everything. Add <code className="text-accent">?source=meta</code> to sync one source and{" "}
          <code className="text-accent">?days=7</code> to narrow the window. Set{" "}
          <code className="text-accent">SYNC_SECRET</code> in your environment and send it as a
          bearer token to lock the endpoint down.
        </p>
      </Card>

      <Card title="Recent syncs">
        {logs.length === 0 ? (
          <Empty>No syncs yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Source</Th>
                  <Th>Status</Th>
                  <Th align="right">Records</Th>
                  <Th>Message</Th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <Td>{formatDate(log.startedAt)}</Td>
                    <Td>{log.source}</Td>
                    <Td>
                      <span className={log.status === "success" ? "text-pos" : "text-neg"}>
                        {log.status}
                      </span>
                    </Td>
                    <Td align="right">{log.records}</Td>
                    <Td className="text-muted">{log.message ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
