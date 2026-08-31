"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const RANGES = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

export function RangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const custom = Boolean(from || to);
  const current = custom ? "custom" : (params.get("range") ?? "30d");
  const [open, setOpen] = useState(custom);

  /** Presets and custom dates are mutually exclusive, so setting one clears the other. */
  function go(next: URLSearchParams) {
    router.push(next.toString() ? `${pathname}?${next}` : pathname);
  }

  function choosePreset(value: string) {
    const next = new URLSearchParams(params.toString());
    next.set("range", value);
    next.delete("from");
    next.delete("to");
    setOpen(false);
    go(next);
  }

  function setDay(field: "from" | "to", value: string) {
    const next = new URLSearchParams(params.toString());
    next.delete("range");
    if (value) next.set(field, value);
    else next.delete(field);
    go(next);
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div className="inline-flex rounded-lg border border-line bg-panel p-0.5">
        {RANGES.map((range) => (
          <button
            key={range.value}
            type="button"
            onClick={() => choosePreset(range.value)}
            className={`rounded-md px-3 py-1.5 text-sm transition ${
              current === range.value
                ? "bg-panel-2 font-medium text-body"
                : "text-muted hover:text-body"
            }`}
          >
            {range.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={`rounded-md px-3 py-1.5 text-sm transition ${
            custom ? "bg-panel-2 font-medium text-body" : "text-muted hover:text-body"
          }`}
          aria-expanded={open}
        >
          Custom
        </button>
      </div>

      {open ? (
        <div className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-2 py-1.5">
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setDay("from", event.target.value)}
            aria-label="From date"
            className="rounded-md border border-line bg-panel-2 px-2 py-1 text-sm outline-none focus:border-accent"
          />
          <span className="text-xs text-muted">to</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setDay("to", event.target.value)}
            aria-label="To date"
            className="rounded-md border border-line bg-panel-2 px-2 py-1 text-sm outline-none focus:border-accent"
          />
          {custom ? (
            <button
              type="button"
              onClick={() => choosePreset("30d")}
              className="text-xs text-muted hover:text-body"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
