import { prisma } from "@/lib/db";
import { getActiveStore } from "@/lib/store";
import { AdvisorChat } from "@/components/advisor-chat";
import { Card } from "@/components/ui";
import { describeAdvisorApiKey } from "@/lib/advisor/api-key";

export const dynamic = "force-dynamic";

export default async function AdvisorPage() {
  const store = await getActiveStore();
  const keySource = await describeAdvisorApiKey();
  const turns = await prisma.advisorMessage.findMany({
    where: { storeId: store.id },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">CFO</h1>
        <p className="mt-0.5 text-sm text-muted">
          A fractional CFO for {store.name}, working from this store&rsquo;s own numbers. It
          reads the figures; it cannot change anything, place an order, or spend money.
        </p>
      </div>

      <Card>
        <AdvisorChat
          storeId={store.id}
          storeName={store.name}
          configured={keySource !== "missing"}
          initial={turns.map((turn) => ({
            id: turn.id,
            role: turn.role,
            content: turn.content,
          }))}
        />
      </Card>
    </div>
  );
}
