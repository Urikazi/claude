"use client";

import { useActionState } from "react";
import { draftTicketReply, type ActionState } from "@/lib/actions";
import { buttonClass, inputClass } from "@/components/ui";

/** Drafts a reply for any ticket on request. Always a private note, whatever the mode. */
export function DraftTicketForm({ storeId }: { storeId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    draftTicketReply,
    null,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="storeId" value={storeId} />
      <input
        name="ticketId"
        inputMode="numeric"
        placeholder="Ticket number, e.g. 1234"
        className={`${inputClass} max-w-56`}
      />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Drafting…" : "Draft a reply"}
      </button>
      {state ? (
        <p className={`text-xs ${state.ok ? "text-pos" : "text-neg"}`}>{state.message}</p>
      ) : null}
    </form>
  );
}
