import { Suspense } from "react";
import Link from "next/link";
import { getActiveStore } from "@/lib/store";
import { requireSession } from "@/lib/session";
import { logout } from "@/lib/auth-actions";
import { SyncButton } from "@/components/sync-button";
import { NavLinks } from "@/components/nav-links";
import { LastSynced } from "@/components/last-synced";
import { BuildMarker } from "@/components/build-marker";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  const store = await getActiveStore();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-panel lg:flex">
        <div className="px-5 py-5">
          <Link href="/dashboard" className="block text-sm font-semibold">
            {store.name}
          </Link>
          <p className="mt-0.5 text-xs text-muted">Profit &amp; loss</p>
        </div>
        <div className="flex-1 px-2">
          {/* useSearchParams needs a boundary; the nav is not worth blocking the page for. */}
          <Suspense fallback={null}>
            <NavLinks />
          </Suspense>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-4">
          <form action={logout}>
            <button type="submit" className="text-xs text-muted hover:text-body">
              Sign out
            </button>
          </form>
          <BuildMarker />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
          <div className="lg:hidden">
            <Suspense fallback={null}>
              <NavLinks />
            </Suspense>
          </div>
          <span className="hidden text-sm text-muted lg:block">{store.name}</span>
          <div className="flex items-center gap-3">
            <Suspense fallback={null}>
              <LastSynced storeId={store.id} />
            </Suspense>
            <SyncButton storeId={store.id} />
          </div>
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
