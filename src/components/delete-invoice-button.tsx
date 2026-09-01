"use client";

import { useActionState } from "react";
import { deleteSupplierInvoice, type ActionState } from "@/lib/actions";

export function DeleteInvoiceButton({ id, label }: { id: string; label: string }) {
  const [, formAction, pending] = useActionState<ActionState, FormData>(
    deleteSupplierInvoice,
    null,
  );
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Remove ${label}`}
        className="rounded-md border border-line px-2 py-1 text-[11px] text-muted transition hover:border-neg hover:text-neg disabled:opacity-50"
      >
        {pending ? "…" : "Remove"}
      </button>
    </form>
  );
}
