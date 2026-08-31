"use client";

import { useActionState, useRef } from "react";
import { logStoreChange, type ActionState } from "@/lib/actions";
import { CHANGE_CATEGORIES } from "@/lib/change-categories";

const field =
  "rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-sm outline-none transition focus:border-accent";

export function ChangeLogForm({ storeId, today }: { storeId: string; today: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await logStoreChange(previous, formData);
      // Only the title and note clear: logging several edits made on one day is the
      // common case, so the date and category stay put.
      if (result?.ok) {
        const form = formRef.current;
        if (form) {
          (form.elements.namedItem("title") as HTMLInputElement | null)?.setAttribute("value", "");
          form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
            "[data-clear]",
          ).forEach((element) => {
            element.value = "";
          });
        }
      }
      return result;
    },
    null,
  );

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="storeId" value={storeId} />
      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          name="date"
          defaultValue={today}
          max={today}
          required
          className={`${field} w-40`}
          aria-label="Date the change went live"
        />
        <select name="category" defaultValue="landing_page" className={`${field} w-44`} aria-label="Kind of change">
          {CHANGE_CATEGORIES.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </select>
        <input
          name="title"
          data-clear
          required
          maxLength={120}
          placeholder="What did you change?"
          className={`${field} min-w-56 flex-1`}
          aria-label="What changed"
        />
      </div>
      <textarea
        name="note"
        data-clear
        rows={2}
        maxLength={2000}
        placeholder="Optional detail — the old price, which creative, what you expected to happen."
        className={`${field} w-full resize-y`}
        aria-label="Notes"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-line bg-panel-2 px-3 py-1.5 text-sm transition hover:border-accent disabled:opacity-50"
        >
          {pending ? "Saving…" : "Log change"}
        </button>
        {state ? (
          <span className={`text-xs ${state.ok ? "text-pos" : "text-neg"}`}>{state.message}</span>
        ) : null}
      </div>
    </form>
  );
}
