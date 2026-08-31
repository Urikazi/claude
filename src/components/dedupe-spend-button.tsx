"use client";

import { useState, useTransition } from "react";
import { removeSupersededManualSpend, type ActionState } from "@/lib/actions";
import { ghostButtonClass } from "@/components/ui";

export function DedupeSpendButton({ storeId }: { storeId: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        className={ghostButtonClass}
        onClick={() =>
          startTransition(async () => setState(await removeSupersededManualSpend(storeId)))
        }
      >
        {pending ? "Removing…" : "Remove manual entries covered by Meta"}
      </button>
      {state ? (
        <span className={`text-xs ${state.ok ? "text-pos" : "text-neg"}`}>{state.message}</span>
      ) : (
        <span className="text-xs text-muted">
          Use this once Meta starts syncing days you had entered by hand — otherwise both are
          counted and the day&apos;s spend doubles.
        </span>
      )}
    </div>
  );
}
