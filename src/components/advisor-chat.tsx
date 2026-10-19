"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass, ghostButtonClass, inputClass } from "@/components/ui";
import { clearAdvisorThread } from "@/lib/actions";

export type AdvisorTurn = { id: string; role: string; content: string };

const SUGGESTIONS = [
  "Give me the financial verdict on the last 90 days.",
  "What are my three largest profit leaks, quantified?",
  "What can I afford to pay to acquire a customer?",
  "Which destinations lose money once fees and fulfilment are in?",
];

/**
 * A plain-text renderer.
 *
 * The replies are headings, short paragraphs, lists and the occasional table. Rendering
 * them as real markdown would mean trusting model output through a parser; splitting on
 * blank lines and bolding heading lines gets the same readability with no HTML at all.
 */
function Reply({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {text.split(/\n{2,}/).map((block, index) => {
        const heading = /^#{1,4}\s+(.*)$/.exec(block.trim());
        if (heading) {
          return (
            <p key={index} className="pt-1 text-sm font-semibold">
              {heading[1]}
            </p>
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap">
            {block}
          </p>
        );
      })}
    </div>
  );
}

export function AdvisorChat({
  storeId,
  storeName,
  initial,
  configured,
}: {
  storeId: string;
  storeName: string;
  initial: AdvisorTurn[];
  configured: boolean;
}) {
  const [turns, setTurns] = useState<AdvisorTurn[]>(initial);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [thinking, setThinking] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, streaming, thinking]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setBusy(true);
    setError(null);
    setDraft("");
    setStreaming("");
    setThinking("");
    setTurns((current) => [...current, { id: `local-${Date.now()}`, role: "user", content: question }]);

    let answer = "";
    try {
      const response = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, message: question }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? `Request failed (${response.status}).`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Newline-delimited JSON: the last fragment may be a partial line.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type: string; text?: string; message?: string };
          if (event.type === "text") {
            answer += event.text ?? "";
            setStreaming(answer);
          } else if (event.type === "thinking") {
            setThinking((current) => current + (event.text ?? ""));
          } else if (event.type === "error") {
            setError(event.message ?? "Something went wrong.");
          }
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      if (answer.trim()) {
        setTurns((current) => [
          ...current,
          { id: `local-a-${Date.now()}`, role: "assistant", content: answer },
        ]);
      }
      setStreaming("");
      setThinking("");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {!configured ? (
        <div className="rounded-lg border border-neg/40 bg-neg/5 p-3 text-xs text-body">
          <strong>No Claude API key is set.</strong> Paste one under{" "}
          <a href="/dashboard/settings" className="underline">
            Store settings
          </a>
          , or set <code>ANTHROPIC_API_KEY</code> on your host and redeploy — the environment
          wins where both are present, and keeps the key out of your database.
        </div>
      ) : null}

      <div className="space-y-4">
        {turns.length === 0 && !busy ? (
          <div className="rounded-lg border border-line p-4">
            <p className="text-sm text-body">
              Every question is answered from a live snapshot of {storeName}&rsquo;s own figures —
              the last 90 days of orders, COGS from your supplier quotes, fees, ad spend and
              audited invoices — with estimates and gaps labelled as such.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  className={`${ghostButtonClass} text-left`}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((turn) =>
          turn.role === "user" ? (
            <div key={turn.id} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-accent/15 px-3 py-2 text-sm">
                {turn.content}
              </p>
            </div>
          ) : (
            <div key={turn.id} className="rounded-lg border border-line px-3 py-2">
              <Reply text={turn.content} />
            </div>
          ),
        )}

        {thinking && !streaming ? (
          <div className="rounded-lg border border-line bg-accent/5 px-3 py-2">
            <p className="text-xs font-semibold text-muted">Working through the numbers…</p>
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{thinking.slice(-1200)}</p>
          </div>
        ) : null}

        {streaming ? (
          <div className="rounded-lg border border-line px-3 py-2">
            <Reply text={streaming} />
          </div>
        ) : null}

        {busy && !streaming && !thinking ? (
          <p className="text-xs text-muted">Reading the last 90 days…</p>
        ) : null}

        {error ? <p className="text-xs text-neg">{error}</p> : null}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
        className="space-y-2"
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline, so a pasted table stays one message.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(draft);
            }
          }}
          rows={3}
          disabled={busy || !configured}
          placeholder={`Ask about ${storeName}'s profit, CAC, pricing, fees or cash. Paste a bank export or P&L to reconcile it.`}
          className={`${inputClass} resize-y`}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy || !configured || !draft.trim()} className={buttonClass}>
            {busy ? "Thinking…" : "Send"}
          </button>
          {turns.length ? (
            <button
              type="button"
              className={ghostButtonClass}
              onClick={async () => {
                if (!confirm(`Clear this conversation for ${storeName}? It cannot be undone.`)) return;
                await clearAdvisorThread(storeId);
                setTurns([]);
              }}
            >
              Clear conversation
            </button>
          ) : null}
          <span className="text-xs text-muted">Shift+Enter for a new line</span>
        </div>
      </form>
    </div>
  );
}
