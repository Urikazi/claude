import Link from "next/link";
import { getActiveStore } from "@/lib/store";
import { SyncButton } from "@/components/sync-button";
import { NavLinks } from "@/components/nav-links";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const store = await getActiveStore();

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-4">
        <div className="flex items-baseline gap-3">
          <Link href="/dashboard" className="text-base font-semibold">
            PNL Dashboard
          </Link>
          <span className="text-sm text-muted">{store.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <NavLinks />
          <SyncButton storeId={store.id} />
        </div>
      </header>
      <main className="flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
