"use client";

import { useActionState } from "react";
import { addManualAdSpend, type ActionState } from "@/lib/actions";
import { Field, buttonClass, inputClass } from "@/components/ui";

export function ManualAdSpendForm({ storeId }: { storeId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    addManualAdSpend,
    null,
  );

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-5 sm:items-end">
      <input type="hidden" name="storeId" value={storeId} />
      <Field label="Date">
        <input
          name="date"
          type="date"
          required
          defaultValue={new Date().toISOString().slice(0, 10)}
          className={inputClass}
        />
      </Field>
      <Field label="Platform">
        <select name="platform" className={inputClass} defaultValue="tiktok">
          <option value="meta">Meta</option>
          <option value="tiktok">TikTok</option>
          <option value="google">Google</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <Field label="Campaign">
        <input name="campaignName" placeholder="Optional" className={inputClass} />
      </Field>
      <Field label="Spend">
        <input
          name="spend"
          type="number"
          step="0.01"
          min="0"
          required
          className={inputClass}
        />
      </Field>
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? "Saving…" : "Add spend"}
      </button>
      {state && (
        <p className={`sm:col-span-5 text-xs ${state.ok ? "text-pos" : "text-neg"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
