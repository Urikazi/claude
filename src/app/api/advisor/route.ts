import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { hasValidSession } from "@/lib/session";
import { ADVISOR_SYSTEM_PROMPT } from "@/lib/advisor/system-prompt";
import { advisorRange, buildAdvisorContext } from "@/lib/advisor/context";
import { getAdvisorApiKey } from "@/lib/advisor/api-key";

export const dynamic = "force-dynamic";
/// Analysis of a quarter's trading takes longer than the default serverless slice.
export const maxDuration = 300;

/**
 * Opus, because this is the work the brief describes: reconciling figures, challenging
 * an assumption, and sizing a recommendation. A cheaper model would be a false economy
 * on a conversation that runs a few times a week and informs what gets spent.
 */
const MODEL = "claude-opus-5-5";

/// How much trading history each turn is answered from.
const CONTEXT_DAYS = 90;

/**
 * Turns kept in the thread.
 *
 * Each one carries a snapshot, so a long history is mostly repeated figures. Keeping
 * the recent turns and re-sending a fresh snapshot is both cheaper and more accurate
 * than carrying every stale one.
 */
const HISTORY_TURNS = 20;

export async function POST(request: Request) {
  // A boolean rather than a throw: an unauthenticated call should be answered 401,
  // not turned into a 500 by the framework.
  if (!(await hasValidSession())) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  // The request is validated before the key is checked, so a malformed call is told
  // what is wrong with it rather than being blamed on the deployment's configuration.
  const input = (await request.json().catch(() => null)) as {
    storeId?: string;
    message?: string;
  } | null;
  const storeId = input?.storeId?.trim();
  const message = input?.message?.trim();
  if (!storeId || !message) {
    return Response.json({ error: "Missing store or message." }, { status: 400 });
  }
  if (message.length > 100_000) {
    return Response.json({ error: "That message is too long to send." }, { status: 400 });
  }

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return Response.json({ error: "Unknown store." }, { status: 404 });

  const { key: apiKey } = await getAdvisorApiKey();
  if (!apiKey) {
    return Response.json(
      {
        error:
          "No Claude API key is set. Paste one under Store settings, or set ANTHROPIC_API_KEY on the host and redeploy — the environment wins where both are present, and keeps the key out of the database.",
      },
      { status: 503 },
    );
  }

  const history = await prisma.advisorMessage.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_TURNS,
  });
  const snapshot = await buildAdvisorContext(storeId, advisorRange(store, CONTEXT_DAYS));

  await prisma.advisorMessage.create({ data: { storeId, role: "user", content: message } });

  const messages: Anthropic.MessageParam[] = [
    ...history
      .reverse()
      .map((entry) => ({
        role: entry.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: entry.content,
      })),
    // The snapshot rides with the question rather than in the system prompt: it changes
    // on every turn, and anything that changes has to sit after the cache breakpoint or
    // it invalidates the prefix each time.
    { role: "user", content: `${snapshot}\n\n---\n\n${message}` },
  ];

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const body = new ReadableStream({
    async start(controller) {
      let answer = "";
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      try {
        const turn = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 32_000,
          // Reasoning is the point here, and the figures deserve it. Summarised so the
          // operator can see the working rather than a long pause.
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: "high" },
          // A safety decline on a finance question would otherwise just stop; the API
          // re-runs it on a fallback model inside the same call.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [
            {
              type: "text",
              text: ADVISOR_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages,
        });

        for await (const event of turn) {
          if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              answer += event.delta.text;
              send({ type: "text", text: event.delta.text });
            } else if (event.delta.type === "thinking_delta") {
              send({ type: "thinking", text: event.delta.thinking });
            }
          }
        }

        const final = await turn.finalMessage();
        if (final.stop_reason === "refusal") {
          send({
            type: "error",
            message: `The model declined this request${
              final.stop_details?.category ? ` (${final.stop_details.category})` : ""
            }. Rephrasing usually clears it.`,
          });
        }
        if (answer.trim()) {
          await prisma.advisorMessage.create({
            data: { storeId, role: "assistant", content: answer },
          });
        }
        send({ type: "done", usage: final.usage.input_tokens + final.usage.output_tokens });
      } catch (error) {
        // The question is already saved, so a failed turn leaves the thread showing
        // what was asked rather than silently losing it.
        const message =
          error instanceof Anthropic.AuthenticationError
            ? "That API key was rejected by Anthropic. Check it under Store settings, and that the account has credit."
            : error instanceof Anthropic.RateLimitError
              ? "Rate limited by the API. Try again in a moment."
              : error instanceof Anthropic.APIError
                ? `API error ${error.status}: ${error.message}`
                : error instanceof Error
                  ? error.message
                  : "Something went wrong.";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Proxies that buffer would defeat the point of streaming at all.
      "X-Accel-Buffering": "no",
    },
  });
}
