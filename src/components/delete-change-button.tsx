"use client";

import { useActionState } from "react";
import { deleteStoreChange, type ActionState } from "@/lib/actions";

export function DeleteChangeButton({ id, title }: { id: string; title: string }) {
  const [, formAction, pending] = useActionState<ActionState, FormData>(
    deleteStoreChange,
    null,
  );
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Remove "${title}" from the change log`}
        className="rounded-md border border-line px-2 py-1 text-[11px] text-muted transition hover:border-neg hover:text-neg disabled:opacity-50"
      >
        {pending ? "…" : "Remove"}
      </button>
    </form>
  );
}
