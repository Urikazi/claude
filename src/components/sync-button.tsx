"use client";

import { useState } from "react";
import { runSync } from "@/lib/actions";
import { buttonClass } from "@/components/ui";

/**
 * Each source is synced in its own request rather than all four in one.
 *
 * A single round of everything has to finish inside the host's request timeout, and
 * a first import of several thousand orders plus two months of ad data does not.
 * When it overran, the function was killed and the button span forever with nothing
 * to show for it. Run per source and each gets the full budget — and the user sees
 * which step is running instead of one long, silent spinner.
 */
const STEPS = [
  { source: "shopify-products", label: "Products" },
  { source: "shopify-orders", label: "Orders" },
  { source: "meta", label: "Meta Ads" },
  { source: "fees", label: "Fees" },
] as const;

type Line = { label: string; ok: boolean; message: string };

export function SyncButton({ storeId }: { storeId: string }) {
  const [running, setRunning] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);

  async function syncAll() {
    setLines([]);
    const collected: Line[] = [];
    for (const step of STEPS) {
      setRunning(step.label);
      try {
        const result = await runSync(storeId, step.source);
        collected.push({
          label: step.label,
          ok: result?.ok ?? false,
          message: result?.message ?? "No response.",
        });
      } catch (error) {
        // A killed request surfaces here as a network error, which is worth naming
        // rather than leaving the row blank.
        collected.push({
          label: step.label,
          ok: false,
          message: error instanceof Error ? error.message : "Request failed.",
        });
      }
      setLines([...collected]);
    }
    setRunning(null);
  }

  return (
    <div className="relative">
      <button type="button" className={buttonClass} disabled={running !== null} onClick={syncAll}>
        {running ? `Syncing ${running}…` : "Sync all"}
      </button>

      {lines && lines.length > 0 && (
        <div className="absolute right-0 top-full z-10 mt-2 w-96 space-y-1.5 rounded-lg border border-line bg-panel p-3 text-xs shadow-xl">
          {lines.map((line) => (
            <div key={line.label} className="flex gap-2">
              <span className={line.ok ? "text-pos" : "text-neg"}>{line.ok ? "✓" : "✕"}</span>
              <span className="shrink-0 font-medium">{line.label}</span>
              <span className={`whitespace-pre-wrap ${line.ok ? "text-muted" : "text-neg"}`}>
                {line.message}
              </span>
            </div>
          ))}
          {running === null && (
            <button
              type="button"
              onClick={() => setLines(null)}
              className="pt-1 text-muted hover:text-body"
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
