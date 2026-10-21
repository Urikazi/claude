import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { hasValidSession } from "@/lib/session";
import { advisorAvailableFor, findAdvisorAgent } from "@/lib/advisor/agents";
import { advisorRange } from "@/lib/advisor/context";
import { getAdvisorApiKey } from "@/lib/advisor/api-key";
import { getAdvisorModel } from "@/lib/advisor/models";
import { prepareAttachments } from "@/lib/advisor/attachments";

export const dynamic = "force-dynamic";
/// Analysis of a quarter's trading takes longer than the default serverless slice.
export const maxDuration = 300;

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
    agent?: string;
    attachments?: unknown;
  } | null;
  const storeId = input?.storeId?.trim();
  const message = input?.message?.trim() ?? "";
  if (!storeId) {
    return Response.json({ error: "Missing store." }, { status: 400 });
  }
  const agent = findAdvisorAgent(input?.agent?.trim());
  if (!agent) return Response.json({ error: "Unknown advisor." }, { status: 400 });
  if (message.length > 100_000) {
    return Response.json({ error: "That message is too long to send." }, { status: 400 });
  }

  const attached = prepareAttachments(input?.attachments);
  if (!attached.ok) return Response.json({ error: attached.error }, { status: 400 });
  const { blocks, transcript } = attached.prepared;
  // A file on its own is a complete request — "here, look at this" — so an empty box
  // with something attached is allowed, and only an empty box with nothing is not.
  if (!message && !blocks.length && !transcript) {
    return Response.json({ error: "Missing store or message." }, { status: 400 });
  }

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return Response.json({ error: "Unknown store." }, { status: 404 });
  // Hiding the chat is not the same as closing it: an advisor written for one brand
  // would answer about another's catalogue if a request simply named it.
  if (!advisorAvailableFor(agent, store.name)) {
    return Response.json(
      { error: `${agent.label} is only available for ${agent.onlyForStore}.` },
      { status: 404 },
    );
  }

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
    where: { storeId, agent: agent.key },
    orderBy: { createdAt: "desc" },
    take: HISTORY_TURNS,
  });
  const snapshot = await agent.buildContext(storeId, advisorRange(store, agent.days));

  /**
   * What the thread keeps.
   *
   * A readable file's text is written into the turn, so the next question can refer
   * back to it without the file being attached again. Images and PDFs leave a note
   * instead: re-sending their bytes on every later turn would cost more than it saves,
   * so they are read for this question only — which the note says, rather than letting
   * a later turn quietly answer about a PDF it can no longer see.
   */
  const recorded = [message, transcript].filter(Boolean).join("\n\n");
  await prisma.advisorMessage.create({
    data: { storeId, agent: agent.key, role: "user", content: recorded },
  });

  const messages: Anthropic.MessageParam[] = [
    ...history
      .reverse()
      .map((entry) => ({
        role: entry.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: entry.content,
      })),
    {
      role: "user",
      // Documents and images lead, ahead of the text that asks about them — the order
      // the API's own guidance gives for a question wrapped around a file.
      content: [
        ...blocks,
        // The snapshot rides with the question rather than in the system prompt: it
        // changes on every turn, and anything that changes has to sit after the cache
        // breakpoint or it invalidates the prefix each time.
        {
          type: "text" as const,
          text: `${snapshot}\n\n---\n\n${recorded || "Read the attached file and tell me what matters in it for this store."}`,
        },
      ],
    },
  ];

  const model = await getAdvisorModel();
  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const body = new ReadableStream({
    async start(controller) {
      let answer = "";
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      try {
        const turn = client.beta.messages.stream({
          model: model.id,
          max_tokens: 32_000,
          // Reasoning is the point here, and the figures deserve it. Summarised so the
          // operator can see the working rather than a long pause.
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: "high" },
          // A safety decline on a finance question would otherwise just stop; where the
          // model supports it the API re-runs the request on a fallback inside the same
          // call. Haiku does not, and sending it the parameter is an error, so the
          // choice of model decides whether it goes at all.
          ...(model.serverSideFallback
            ? { betas: ["server-side-fallback-2026-07-01" as const], fallbacks: "default" as const }
            : {}),
          system: [
            {
              type: "text",
              text: agent.systemPrompt,
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
            data: { storeId, agent: agent.key, role: "assistant", content: answer },
          });
        }
        send({
          type: "done",
          usage: final.usage.input_tokens + final.usage.output_tokens,
          // The model that actually served it, which a refusal fallback can change.
          model: final.model,
        });
      } catch (error) {
        // The question is already saved, so a failed turn leaves the thread showing
        // what was asked rather than silently losing it.
        const message =
          error instanceof Anthropic.AuthenticationError
            ? "That API key was rejected by Anthropic. Check it under Store settings, and that the account has credit."
            : error instanceof Anthropic.RateLimitError
              ? "Rate limited by the API. Try again in a moment."
              : error instanceof Anthropic.APIError
                ? `API error ${error.status} on ${model.label}: ${error.message}`
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
