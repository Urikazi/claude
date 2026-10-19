import "server-only";
import { prisma } from "@/lib/db";

/**
 * Where the CFO page gets its Claude API key.
 *
 * Two sources, environment first. An operator who sets ANTHROPIC_API_KEY on the host
 * keeps the key out of the database entirely, which is the safer arrangement and must
 * not be silently overridden by something pasted into a form later.
 *
 * The stored key is the fallback, for a deployment where editing environment variables
 * and redeploying is more friction than it is worth. It sits in the database in plain
 * text, like every other provider credential here, so the database connection string is
 * as sensitive as the key itself — and this one can spend money.
 *
 * Stored once for the whole dashboard rather than per store: it is one Anthropic
 * account, and asking for the same key twice would only invite one copy going stale.
 */

const KEY = "advisor.anthropic_api_key";

export type ApiKeySource = "environment" | "stored" | "missing";

export async function getAdvisorApiKey(): Promise<{ key: string | null; source: ApiKeySource }> {
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "environment" };

  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const stored = row?.value.trim();
  return stored ? { key: stored, source: "stored" } : { key: null, source: "missing" };
}

/** Whether a key exists, without reading it. For rendering a form safely. */
export async function describeAdvisorApiKey(): Promise<ApiKeySource> {
  return (await getAdvisorApiKey()).source;
}

/**
 * An Anthropic key starts `sk-ant-`. An OpenAI key starts `sk-` and nothing else, and
 * pasting one here is the easy mistake — it would otherwise surface much later as an
 * authentication failure that says nothing about which key was wrong.
 */
export function describeApiKeyProblem(key: string): string | null {
  if (key.startsWith("sk-ant-")) return null;
  if (key.startsWith("sk-")) {
    return "That looks like an OpenAI key. This page calls Claude, whose keys start with sk-ant-. Get one at console.anthropic.com.";
  }
  return "Anthropic API keys start with sk-ant-. Copy the whole key from console.anthropic.com.";
}

export async function setAdvisorApiKey(key: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: key },
    update: { value: key },
  });
}

export async function clearAdvisorApiKey(): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: KEY } });
}
