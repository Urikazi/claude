"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const SECTIONS = [
  {
    title: "Reports",
    links: [
      { href: "/dashboard", label: "Dashboard", icon: "▦" },
      { href: "/dashboard/products", label: "Product analytics", icon: "▤" },
      { href: "/dashboard/orders", label: "Orders report", icon: "▥" },
      { href: "/dashboard/conversion", label: "Conversion rate", icon: "◈" },
      { href: "/dashboard/ads", label: "Ad spend", icon: "◑" },
    ],
  },
  {
    title: "Configuration",
    links: [{ href: "/dashboard/settings", label: "Store settings", icon: "⚙" }],
  },
];

export function NavLinks() {
  const pathname = usePathname();
  const params = useSearchParams();

  // The chosen range follows you between reports, so switching pages does not
  // silently reset you to the last 30 days.
  const query = params.toString();

  return (
    <nav className="space-y-6">
      {SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted">
            {section.title}
          </p>
          <div className="space-y-0.5">
            {section.links.map((link) => {
              const active =
                link.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={query ? `${link.href}?${query}` : link.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? "bg-panel-2 font-medium text-accent"
                      : "text-muted hover:bg-panel-2/50 hover:text-body"
                  }`}
                >
                  <span aria-hidden className="text-xs opacity-80">
                    {link.icon}
                  </span>
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
