"use client";

import { useActionState } from "react";
import { login } from "@/lib/auth-actions";
import type { ActionState } from "@/lib/actions";
import { buttonClass, inputClass } from "@/components/ui";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(login, null);

  return (
    <form action={formAction} className="mt-6 space-y-3">
      <input
        name="password"
        type="password"
        autoFocus
        autoComplete="current-password"
        placeholder="Password"
        className={inputClass}
      />
      <button type="submit" disabled={pending} className={`${buttonClass} w-full`}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {state && !state.ok ? <p className="text-xs text-neg">{state.message}</p> : null}
    </form>
  );
}
