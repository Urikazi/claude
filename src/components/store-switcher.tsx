"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createStore, selectStore, type ActionState } from "@/lib/actions";

export type StoreOption = { id: string; name: string };

/**
 * Picks which store every report is about.
 *
 * Sits where the store's name already was, because that name was the only thing on the
 * page saying whose figures these are — and on a dashboard showing more than one
 * business, that is the first thing to be sure of.
 */
export function StoreSwitcher({
  stores,
  activeId,
}: {
  stores: StoreOption[];
  activeId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [state, setState] = useState<ActionState>(null);

  const switchTo = (id: string) => {
    if (id === activeId) return;
    startTransition(async () => {
      const result = await selectStore(id);
      setState(result);
      if (result?.ok) router.refresh();
    });
  };

  const add = (formData: FormData) => {
    startTransition(async () => {
      const result = await createStore(null, formData);
      setState(result);
      if (result?.ok) {
        setAdding(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2">
      {stores.length > 1 ? (
        <select
          value={activeId}
          disabled={pending}
          onChange={(event) => switchTo(event.target.value)}
          aria-label="Store"
          className="w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-sm font-semibold outline-none transition focus:border-accent disabled:opacity-60"
        >
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-sm font-semibold">{stores[0]?.name ?? "My Store"}</p>
      )}

      {adding ? (
        <form action={add} className="space-y-1.5">
          <input
            name="name"
            autoFocus
            required
            maxLength={80}
            placeholder="Store name"
            className="w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <input
            name="currency"
            defaultValue="USD"
            maxLength={3}
            aria-label="Reporting currency"
            className="w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs uppercase outline-none focus:border-accent"
          />
          <div className="flex gap-1.5">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md border border-line bg-panel-2 px-2 py-1 text-xs transition hover:border-accent disabled:opacity-50"
            >
              {pending ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-md border border-line px-2 py-1 text-xs text-muted transition hover:border-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setState(null);
            setAdding(true);
          }}
          className="text-xs text-muted transition hover:text-body"
        >
          + Add store
        </button>
      )}

      {state && !state.ok ? <p className="text-xs text-neg">{state.message}</p> : null}
    </div>
  );
}
