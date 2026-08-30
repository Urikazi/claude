"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const RANGES = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

export function RangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("range") ?? "30d";

  return (
    <div className="inline-flex rounded-lg border border-line bg-panel p-0.5">
      {RANGES.map((range) => (
        <button
          key={range.value}
          type="button"
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            next.set("range", range.value);
            router.push(`${pathname}?${next}`);
          }}
          className={`rounded-md px-3 py-1.5 text-sm transition ${
            current === range.value
              ? "bg-panel-2 font-medium text-body"
              : "text-muted hover:text-body"
          }`}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
