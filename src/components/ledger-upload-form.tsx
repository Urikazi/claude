"use client";

import { useActionState, useRef } from "react";
import { uploadSupplierLedger, type ActionState } from "@/lib/actions";

export function LedgerUploadForm({ storeId, storeName }: { storeId: string; storeName: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await uploadSupplierLedger(previous, formData);
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
          name="ledger"
          accept=".csv,text/csv,text/plain"
          required
          className="max-w-md text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-panel-2 file:px-3 file:py-1.5 file:text-sm file:text-body hover:file:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-line bg-panel-2 px-3 py-1.5 text-sm transition hover:border-accent disabled:opacity-50"
        >
          {pending ? "Importing…" : "Import ledger"}
        </button>
      </div>
      {state ? (
        <p className={`text-xs ${state.ok ? "text-pos" : "text-neg"}`}>{state.message}</p>
      ) : null}
      <p className="text-xs text-muted">
        The supplier&rsquo;s payment ledger: open it in Google Sheets on the year&rsquo;s tab,
        then File &gt; Download &gt; Comma-separated values. Upload the whole sheet each day —
        it replaces the last import, so nothing is counted twice. Only {storeName}&rsquo;s
        lines are taken from it.
      </p>
    </form>
  );
}
