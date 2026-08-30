"use client";

import { useState, useTransition } from "react";
import { runSync } from "@/lib/actions";
import { buttonClass } from "@/components/ui";

export function SyncButton({ storeId }: { storeId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <div className="relative">
      <button
        type="button"
        className={buttonClass}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(await runSync(storeId, "all"));
          })
        }
      >
        {pending ? "Syncing…" : "Sync all"}
      </button>
      {result && (
        <div
          className={`absolute right-0 top-full z-10 mt-2 w-96 rounded-lg border p-3 text-xs shadow-xl ${
            result.ok
              ? "border-pos/40 bg-panel text-body"
              : "border-neg/40 bg-panel text-neg"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="whitespace-pre-wrap">{result.message}</span>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="shrink-0 text-muted hover:text-body"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
