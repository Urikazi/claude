"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { buttonClass, ghostButtonClass, inputClass } from "@/components/ui";
import { clearAdvisorThread } from "@/lib/actions";
import {
  ATTACHMENT_ACCEPT,
  classifyAttachment,
  formatBytes,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "@/lib/advisor/attachment-kinds";

type Picked = { id: string; name: string; size: number; data: string };

/**
 * A file's bytes as base64, read in chunks.
 *
 * `String.fromCharCode(...bytes)` on a whole megabyte-sized array blows the call stack,
 * and it does so only for the larger files — exactly the ones worth attaching — so the
 * chunking is not optional.
 */
async function readAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * A question as it sits in the thread.
 *
 * An attached spreadsheet is written into the turn so later questions can still refer
 * to it, which makes some turns thousands of lines long. Clamped by default: the thread
 * stays readable, and the text is still there for anyone who wants to check what the
 * model was actually given.
 */
function Question({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 700;
  return (
    <div className="max-w-[85%] rounded-lg bg-accent/15 px-3 py-2">
      <p className="whitespace-pre-wrap break-words text-sm">
        {long && !open ? `${text.slice(0, 700)}…` : text}
      </p>
      {long ? (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="mt-1 text-xs text-muted underline"
        >
          {open ? "Show less" : `Show all ${text.length.toLocaleString()} characters`}
        </button>
      ) : null}
    </div>
  );
}

export type AdvisorTurn = { id: string; role: string; content: string };

/**
 * Renders an advisor's reply.
 *
 * The briefs ask for verdicts, scorecards and prioritised actions, and both models
 * answer in markdown — headings, bold figures, comparison tables. Rendered as plain
 * text that arrives as literal asterisks and pipe characters, which is unreadable
 * exactly where the numbers matter most.
 *
 * Markdown is turned into React elements rather than HTML: no raw-HTML plugin is
 * enabled, so there is no markup from model output to inject. The element map styles
 * it with the dashboard's own table and type scale, so a figure in a reply reads the
 * same as a figure in a report.
 */
function Reply({ text }: { text: string }) {
  return (
    <div className="advisor-reply space-y-3 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 className="pt-1 text-sm font-semibold text-fg">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="pt-1 text-sm font-semibold text-fg">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="pt-1 text-sm font-semibold text-fg">{children}</h4>
          ),
          h4: ({ children }) => (
            <h4 className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {children}
            </h4>
          ),
          p: ({ children }) => <p className="text-sm leading-relaxed">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold text-fg">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5 text-sm">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5 text-sm">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          // Tables carry the figures, so they get the dashboard's own table styling
          // and a scroll container — a per-country breakdown is wider than the column.
          table: ({ children }) => (
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="text-muted">{children}</thead>,
          tr: ({ children }) => <tr className="border-b border-line">{children}</tr>,
          // `style` carries the column alignment from the markdown (`|---:|`), which a
          // financial table needs: a column of figures is only comparable down the
          // page when the digits line up on the right.
          th: ({ children, style }) => (
            <th
              style={style}
              className="whitespace-nowrap px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-muted"
            >
              {children}
            </th>
          ),
          td: ({ children, style }) => (
            <td style={style} className="px-2 py-1.5 align-top tabular-nums">
              {children}
            </td>
          ),
          code: ({ children }) => (
            <code className="rounded bg-accent/10 px-1 py-0.5 font-mono text-[0.85em]">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg border border-line p-3 font-mono text-xs">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-accent/50 pl-3 text-sm text-body">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-line" />,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent underline"
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function AdvisorChat({
  storeId,
  storeName,
  agent,
  agentLabel,
  suggestions,
  days,
  initial,
  configured,
}: {
  storeId: string;
  storeName: string;
  agent: string;
  agentLabel: string;
  suggestions: string[];
  days: number;
  initial: AdvisorTurn[];
  configured: boolean;
}) {
  const [turns, setTurns] = useState<AdvisorTurn[]>(initial);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [thinking, setThinking] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<Picked[]>([]);
  const [dragging, setDragging] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Check a file here, before it is uploaded.
   *
   * The server checks all of this again — it has to, since nothing stops a request
   * being made by hand — but finding out that a 40 MB export is too big after waiting
   * for it to upload is a bad way to find out.
   */
  async function addFiles(incoming: FileList | File[]) {
    const chosen = Array.from(incoming);
    if (!chosen.length) return;
    setError(null);

    const next: Picked[] = [];
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of chosen) {
      if (files.length + next.length >= MAX_ATTACHMENTS) {
        setError(`Up to ${MAX_ATTACHMENTS} files at a time.`);
        break;
      }
      const classified = classifyAttachment(file.name);
      if (classified.kind === "unsupported") {
        setError(classified.reason);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(
          `${file.name} is ${formatBytes(file.size)}, over the ${formatBytes(MAX_ATTACHMENT_BYTES)} limit for one file.`,
        );
        continue;
      }
      total += file.size;
      if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
        setError(
          `That comes to more than ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} together. Send them across a couple of questions.`,
        );
        break;
      }
      next.push({
        id: `${file.name}-${file.size}-${Date.now()}-${next.length}`,
        name: file.name,
        size: file.size,
        data: await readAsBase64(file),
      });
    }
    if (next.length) setFiles((current) => [...current, ...next]);
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, streaming, thinking]);

  async function send(text: string) {
    const question = text.trim();
    // A file on its own is a complete request, so an empty box with something attached
    // still sends.
    if ((!question && !files.length) || busy) return;
    const attachments = files.map(({ name, data }) => ({ name, data }));
    setBusy(true);
    setError(null);
    setDraft("");
    setStreaming("");
    setThinking("");
    setFiles([]);
    setTurns((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        role: "user",
        // Shown as a note rather than the file's contents: the saved turn the server
        // writes carries the text itself, and this placeholder is replaced by it on
        // the next load.
        content: [question, ...files.map((file) => `[Attached: ${file.name}, ${formatBytes(file.size)}]`)]
          .filter(Boolean)
          .join("\n\n"),
      },
    ]);

    let answer = "";
    try {
      const response = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, agent, message: question, attachments }),
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
              Every question is answered from a live snapshot of {storeName}&rsquo;s own figures,
              covering the last {days} days, with estimates and gaps labelled as such. Attach a
              CSV, a PDF, or a screenshot to have it read alongside them — a spreadsheet stays in
              the conversation for follow-up questions, while images and PDFs are read once.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
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
              <Question text={turn.content} />
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
          <p className="text-xs text-muted">Reading the last {days} days…</p>
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
        // Dropping onto the composer is the gesture people try first with a file they
        // already have open in a folder beside the browser.
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy && configured) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (busy || !configured) return;
          void addFiles(event.dataTransfer.files);
        }}
      >
        {files.length ? (
          <ul className="flex flex-wrap gap-2">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-2 py-1 text-xs"
              >
                <span className="max-w-[18rem] truncate">{file.name}</span>
                <span className="text-muted">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles((current) => current.filter((item) => item.id !== file.id))}
                  className="text-muted hover:text-neg"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}

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
          placeholder={`Ask ${agentLabel.toLowerCase()} about ${storeName}. Attach an export, an invoice or a screenshot to have it read against this store's own numbers.`}
          className={`${inputClass} resize-y ${dragging ? "border-accent" : ""}`}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy || !configured || (!draft.trim() && !files.length)}
            className={buttonClass}
          >
            {busy ? "Thinking…" : "Send"}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(event) => {
              if (event.target.files) void addFiles(event.target.files);
              // Cleared so picking the same file twice in a row still fires a change.
              event.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={busy || !configured}
            onClick={() => fileRef.current?.click()}
            className={ghostButtonClass}
          >
            Attach a file
          </button>
          {turns.length ? (
            <button
              type="button"
              className={ghostButtonClass}
              onClick={async () => {
                if (!confirm(`Clear this ${agentLabel} conversation for ${storeName}? It cannot be undone.`)) return;
                await clearAdvisorThread(storeId, agent);
                setTurns([]);
              }}
            >
              Clear conversation
            </button>
          ) : null}
          <span className="text-xs text-muted">
            Shift+Enter for a new line · CSV, PDF, image or text, up to{" "}
            {formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}
          </span>
        </div>
      </form>
    </div>
  );
}
