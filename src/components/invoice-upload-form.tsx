"use client";

import { useActionState, useRef } from "react";
import { auditSupplierInvoice, type ActionState } from "@/lib/actions";

export function InvoiceUploadForm({ storeId }: { storeId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await auditSupplierInvoice(previous, formData);
      if (result?.ok) formRef.current?.reset();
      return result;
    },
    null,
  );

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="storeId" value={storeId} />
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="invoice"
          accept=".csv,text/csv,text/plain"
          required
          className="max-w-md text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-panel-2 file:px-3 file:py-1.5 file:text-sm file:text-body hover:file:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-line bg-panel-2 px-3 py-1.5 text-sm transition hover:border-accent disabled:opacity-50"
        >
          {pending ? "Checking…" : "Check invoice"}
        </button>
      </div>
      {state ? (
        <p className={`text-xs ${state.ok ? "text-pos" : "text-neg"}`}>{state.message}</p>
      ) : null}
      <p className="text-xs text-muted">
        The daily order export your supplier sends, saved as CSV. Every billed line is
        priced against your imported price list and anything above it is listed below.
      </p>
    </form>
  );
}
