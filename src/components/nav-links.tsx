"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/products", label: "Products & COGS" },
  { href: "/dashboard/orders", label: "Orders" },
  { href: "/dashboard/ads", label: "Ad spend" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-1">
      {LINKS.map((link) => {
        const active =
          link.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              active
                ? "bg-panel-2 font-medium text-body"
                : "text-muted hover:text-body"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
