"use client";

import { useActionState } from "react";
import { importAdSpendPaste, type ActionState } from "@/lib/actions";
import { Field, buttonClass, inputClass } from "@/components/ui";

export function AdSpendPasteForm({ storeId }: { storeId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    importAdSpendPaste,
    null,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="storeId" value={storeId} />
      <p className="text-xs text-muted">
        In Ads Manager, switch the report to a daily breakdown, select the rows and copy
        them. Paste here — dates and amounts are picked out of whatever columns you paste,
        and currency symbols, thousands separators and header rows are all fine. Pasting a
        day again replaces it rather than adding to it.
      </p>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr] sm:items-start">
        <Field label="Platform">
          <select name="platform" className={inputClass} defaultValue="meta">
            <option value="meta">Meta</option>
            <option value="tiktok">TikTok</option>
            <option value="google">Google</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Rows">
          <textarea
            name="rows"
            rows={8}
            spellCheck={false}
            placeholder={"2026-08-01\t124.53\n2026-08-02\t$1,240.10\nAug 3, 2026\t98"}
            className={`${inputClass} font-mono text-xs`}
          />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Importing…" : "Import rows"}
        </button>
        {state ? (
          <p className={`text-xs ${state.ok ? "text-pos" : "text-neg"}`}>{state.message}</p>
        ) : null}
      </div>
    </form>
  );
}
