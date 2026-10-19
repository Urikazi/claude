import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveStore } from "@/lib/store";
import { AdvisorChat } from "@/components/advisor-chat";
import { Card } from "@/components/ui";
import { describeAdvisorApiKey } from "@/lib/advisor/api-key";
import { findAdvisorAgent } from "@/lib/advisor/agents";
import { getAdvisorModel } from "@/lib/advisor/models";

export const dynamic = "force-dynamic";

export default async function AdvisorPage({
  params,
}: {
  params: Promise<{ agent: string }>;
}) {
  const { agent: key } = await params;
  const agent = findAdvisorAgent(key);
  if (!agent) notFound();

  const store = await getActiveStore();
  const [keySource, model, turns] = await Promise.all([
    describeAdvisorApiKey(),
    getAdvisorModel(),
    prisma.advisorMessage.findMany({
      where: { storeId: store.id, agent: agent.key },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{agent.label}</h1>
        <p className="mt-0.5 text-sm text-muted">{agent.blurb}</p>
        <p className="mt-1 text-xs text-muted">
          Running on {model.label}.{" "}
          <Link href="/dashboard/settings" className="underline">
            Change the model
          </Link>
        </p>
      </div>

      <Card>
        <AdvisorChat
          storeId={store.id}
          storeName={store.name}
          agent={agent.key}
          agentLabel={agent.label}
          suggestions={agent.suggestions}
          days={agent.days}
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
