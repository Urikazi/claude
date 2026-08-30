"use client";

import { useActionState } from "react";
import { createFirstPassword } from "@/lib/auth-actions";
import type { ActionState } from "@/lib/actions";
import { buttonClass, inputClass } from "@/components/ui";

export function SetupForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createFirstPassword,
    null,
  );

  return (
    <form action={formAction} className="mt-6 space-y-3">
      <input
        name="password"
        type="password"
        autoFocus
        autoComplete="new-password"
        placeholder="At least 12 characters"
        className={inputClass}
      />
      <input
        name="confirm"
        type="password"
        autoComplete="new-password"
        placeholder="Repeat it"
        className={inputClass}
      />
      <button type="submit" disabled={pending} className={`${buttonClass} w-full`}>
        {pending ? "Saving…" : "Set password and continue"}
      </button>
      {state && !state.ok ? <p className="text-xs text-neg">{state.message}</p> : null}
    </form>
  );
}
